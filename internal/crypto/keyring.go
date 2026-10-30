package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"

	"dhub/internal/config"
	"github.com/zalando/go-keyring"
)

const serviceName = "dhub"

func SaveSecret(key, secret string) error {
	// Try OS Keyring first
	err := keyring.Set(serviceName, key, secret)
	if err == nil {
		return nil
	}
	// Fallback to local encrypted file
	return saveFallbackSecret(key, secret)
}

func GetSecret(key string) (string, error) {
	secret, err := keyring.Get(serviceName, key)
	if err == nil {
		return secret, nil
	}
	return getFallbackSecret(key)
}

func DeleteSecret(key string) error {
	_ = keyring.Delete(serviceName, key)
	return deleteFallbackSecret(key)
}

// Fallback encryption using AES-256-GCM with a machine-local key
func getMasterKey() ([]byte, error) {
	dir, err := config.GetConfigDir()
	if err != nil {
		return nil, err
	}
	keyPath := filepath.Join(dir, ".vault.key")
	if data, err := os.ReadFile(keyPath); err == nil && len(data) == 32 {
		return data, nil
	}
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	_ = os.WriteFile(keyPath, key, 0600)
	return key, nil
}

func saveFallbackSecret(key, secret string) error {
	masterKey, err := getMasterKey()
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}
	cipherText := gcm.Seal(nonce, nonce, []byte(secret), nil)
	encoded := base64.StdEncoding.EncodeToString(cipherText)

	dir, err := config.GetConfigDir()
	if err != nil {
		return err
	}
	vaultDir := filepath.Join(dir, "vault")
	_ = os.MkdirAll(vaultDir, 0700)
	return os.WriteFile(filepath.Join(vaultDir, key+".enc"), []byte(encoded), 0600)
}

func getFallbackSecret(key string) (string, error) {
	dir, err := config.GetConfigDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, "vault", key+".enc")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	cipherText, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil {
		return "", err
	}
	masterKey, err := getMasterKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(cipherText) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	nonce, cipherText := cipherText[:nonceSize], cipherText[nonceSize:]
	plainText, err := gcm.Open(nil, nonce, cipherText, nil)
	if err != nil {
		return "", err
	}
	return string(plainText), nil
}

func deleteFallbackSecret(key string) error {
	dir, err := config.GetConfigDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "vault", key+".enc")
	return os.Remove(path)
}

