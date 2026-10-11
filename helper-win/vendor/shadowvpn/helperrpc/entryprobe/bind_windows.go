package entryprobe

import (
	"errors"
	"golang.org/x/sys/windows"
	"math/bits"
	"net"
	"strings"
	"syscall"
	"unsafe"
)

// Use IP Helper's hardware flag, not interface names or Ethernet type alone:
// virtual Ethernet adapters can otherwise look like a physical bypass.
func physicalInterface(iface net.Interface) bool {
	row := windows.MibIfRow2{InterfaceIndex: uint32(iface.Index)}
	return windows.GetIfEntry2Ex(windows.MibIfEntryNormalWithoutStatistics, &row) == nil &&
		row.InterfaceAndOperStatusFlags&1 != 0 && row.OperStatus == 1 && row.TunnelType == 0 && row.InterfaceAndOperStatusFlags&0x80 == 0
}
func familyInterfaceIndex(iface net.Interface, ipv6 bool) (uint32, error) {
	var size uint32 = 15000
	for attempt := 0; attempt < 3; attempt++ {
		if size == 0 || size > 1<<20 {
			break
		}
		buffer := make([]byte, size)
		head := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buffer[0]))
		err := windows.GetAdaptersAddresses(windows.AF_UNSPEC, windows.GAA_FLAG_INCLUDE_ALL_INTERFACES, 0, head, &size)
		if err == windows.ERROR_BUFFER_OVERFLOW {
			continue
		}
		if err != nil {
			return 0, err
		}
		for item := head; item != nil; item = item.Next {
			if int(item.IfIndex) == iface.Index || int(item.Ipv6IfIndex) == iface.Index {
				index := item.IfIndex
				if ipv6 {
					index = item.Ipv6IfIndex
				}
				if index > 0 {
					return index, nil
				}
			}
		}
		break
	}
	return 0, errors.New("interface unavailable")
}
func bindInterface(network string, raw syscall.RawConn, iface net.Interface) error {
	ipv6 := strings.HasSuffix(network, "6")
	index, err := familyInterfaceIndex(iface, ipv6)
	if err != nil {
		return err
	}
	var bindErr error
	err = raw.Control(func(fd uintptr) {
		// IP_UNICAST_IF uses network byte order; IPV6_UNICAST_IF uses host byte order.
		level, value := syscall.IPPROTO_IP, int(bits.ReverseBytes32(index))
		if ipv6 {
			level, value = syscall.IPPROTO_IPV6, int(index)
		}
		bindErr = syscall.SetsockoptInt(syscall.Handle(fd), level, 31, value)
	})
	if err != nil {
		return err
	}
	return bindErr
}
