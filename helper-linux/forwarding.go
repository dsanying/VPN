package main

import (
	"errors"
	"fmt"
	"strings"
)

var forwardingFiles = []string{"/proc/sys/net/ipv4/ip_forward", "/proc/sys/net/ipv6/conf/all/forwarding"}

// 只记录本会话的 0→1；失败回滚和退出都保留原已启用的转发。
func enableForwarding(paths []string, read func(string) ([]byte, error), write func(string, []byte) error) (func() error, error) {
	changed := []string{}
	restore := func() error {
		var failures []error
		for _, name := range changed {
			current, err := read(name)
			if err != nil {
				failures = append(failures, err)
				continue
			}
			if strings.TrimSpace(string(current)) == "1" {
				if err := write(name, []byte("0")); err != nil {
					failures = append(failures, err)
				}
			}
		}
		return errors.Join(failures...)
	}
	for _, name := range paths {
		previous, err := read(name)
		if err != nil {
			return restore, errors.Join(err, restore())
		}
		value := strings.TrimSpace(string(previous))
		if value != "0" && value != "1" {
			return restore, errors.Join(fmt.Errorf("invalid forwarding state %s", name), restore())
		}
		if value == "0" {
			if err := write(name, []byte("1")); err != nil {
				return restore, errors.Join(err, restore())
			}
			changed = append(changed, name)
		}
	}
	return restore, nil
}
