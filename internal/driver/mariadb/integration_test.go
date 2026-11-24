//go:build integration

package mariadb

import (
	"os"
	"testing"

	"dhub/internal/driver/mysqlsuite"
)

func TestIntegration(t *testing.T) {
	dsn := os.Getenv("DHUB_MARIADB_DSN")
	if dsn == "" {
		dsn = "dhub:dhub@tcp(localhost:53307)/dhub?parseTime=true"
	}
	drv, err := NewMariaDBDriver(dsn)
	if err != nil {
		t.Skipf("mariadb unavailable: %v", err)
	}
	defer drv.Close()
	if err := drv.Ping(t.Context()); err != nil {
		t.Skipf("mariadb not reachable at %s: %v", dsn, err)
	}
	mysqlsuite.Run(t, drv, "dhub")
}
