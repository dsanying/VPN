package entryprobe

import (
	"net"
	"os"
	"path/filepath"
	"syscall"
)

func physicalInterface(iface net.Interface) bool {
	if iface.Flags&net.FlagLoopback != 0 {
		return false
	}
	_, err := os.Stat(filepath.Join("/sys/class/net", iface.Name, "device"))
	return err == nil
}
func bindInterface(network string, raw syscall.RawConn, iface net.Interface) error {
	var bindErr error
	err := raw.Control(func(fd uintptr) {
		bindErr = syscall.SetsockoptString(int(fd), syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, iface.Name)
	})
	if err != nil {
		return err
	}
	return bindErr
}
