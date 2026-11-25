//go:build windows

package services

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// hideCommandWindow configures cmd so Windows does not open or flash a console window.
func hideCommandWindow(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
