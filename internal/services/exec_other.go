//go:build !windows

package services

import "os/exec"

func hideCommandWindow(_ *exec.Cmd) {}
