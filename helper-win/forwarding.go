package main

import "errors"

type forwardingInterface struct {
	Index   int
	Family  string
	Enabled bool
}

// 只恢复原 Disabled 的接口；原有路由服务已启用的转发不属于本会话。
func enableForwarding(read func() ([]forwardingInterface, error), write func([]forwardingInterface, bool) error) (func() error, error) {
	values, err := read()
	if err != nil {
		return func() error { return nil }, err
	}
	changed := []forwardingInterface{}
	for _, value := range values {
		if !value.Enabled {
			changed = append(changed, value)
		}
	}
	restore := func() error { return write(changed, false) }
	if err := write(changed, true); err != nil {
		return restore, errors.Join(err, restore())
	}
	return restore, nil
}
