package main

import (
	"errors"
	"reflect"
	"testing"
)

func TestForwardingPreservesEnabledInterfaces(t *testing.T) {
	enabled := forwardingInterface{Index: 1, Family: "IPv4", Enabled: true}
	disabled := forwardingInterface{Index: 2, Family: "IPv6"}
	writes := [][]forwardingInterface{}
	states := []bool{}
	restore, err := enableForwarding(func() ([]forwardingInterface, error) { return []forwardingInterface{enabled, disabled}, nil }, func(values []forwardingInterface, state bool) error {
		writes = append(writes, values)
		states = append(states, state)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(writes, [][]forwardingInterface{{disabled}, {disabled}}) || !reflect.DeepEqual(states, []bool{true, false}) {
		t.Fatal(writes, states)
	}
}
func TestForwardingRollsBackPartialFailure(t *testing.T) {
	states := []bool{}
	_, err := enableForwarding(func() ([]forwardingInterface, error) { return []forwardingInterface{{Index: 2, Family: "IPv6"}}, nil }, func(_ []forwardingInterface, state bool) error {
		states = append(states, state)
		if state {
			return errors.New("failed halfway")
		}
		return nil
	})
	if err == nil || !reflect.DeepEqual(states, []bool{true, false}) {
		t.Fatal(err, states)
	}
}
func TestForwardingSnapshotFailureDoesNotWrite(t *testing.T) {
	writes := 0
	_, err := enableForwarding(func() ([]forwardingInterface, error) { return nil, errors.New("unavailable") }, func([]forwardingInterface, bool) error { writes++; return nil })
	if err == nil || writes != 0 {
		t.Fatal(err, writes)
	}
}
