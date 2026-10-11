package entryprobe

import (
	"net"
	"regexp"
	"strings"
	"syscall"
)

var physicalName = regexp.MustCompile(`^en[0-9]+$`)

func physicalInterface(iface net.Interface) bool { return physicalName.MatchString(iface.Name) }
func bindInterface(network string, raw syscall.RawConn, iface net.Interface) error {
	var bindErr error
	err := raw.Control(func(fd uintptr) {
		level, option := syscall.IPPROTO_IP, syscall.IP_BOUND_IF
		if strings.HasSuffix(network, "6") {
			level, option = syscall.IPPROTO_IPV6, syscall.IPV6_BOUND_IF
		}
		bindErr = syscall.SetsockoptInt(int(fd), level, option, iface.Index)
	})
	if err != nil {
		return err
	}
	return bindErr
}
