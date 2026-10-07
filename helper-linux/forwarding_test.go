package main

import (
	"errors"
	"reflect"
	"testing"
)

func TestForwardingPreservesExistingAndRestoresSession(t *testing.T) {
	state := map[string]string{"v4": "1", "v6": "0"}
	writes := []string{}
	restore, err := enableForwarding([]string{"v4", "v6"}, func(name string) ([]byte, error) { return []byte(state[name]), nil }, func(name string, value []byte) error {
		state[name] = string(value)
		writes = append(writes, name+"="+string(value))
		return nil
	})
	if err != nil || state["v4"] != "1" || state["v6"] != "1" {
		t.Fatal(err, state)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if state["v4"] != "1" || state["v6"] != "0" || !reflect.DeepEqual(writes, []string{"v6=1", "v6=0"}) {
		t.Fatal(state, writes)
	}
}
func TestForwardingRollsBackPartialFailure(t *testing.T) {
	state := map[string]string{"v4": "0", "v6": "0"}
	_, err := enableForwarding([]string{"v4", "v6"}, func(name string) ([]byte, error) { return []byte(state[name]), nil }, func(name string, value []byte) error {
		if name == "v6" {
			return errors.New("permission denied")
		}
		state[name] = string(value)
		return nil
	})
	if err == nil || state["v4"] != "0" || state["v6"] != "0" {
		t.Fatal(err, state)
	}
}
func TestForwardingDoesNotOverwriteExternalDisable(t *testing.T) {
	state := "0"
	writes := 0
	restore, err := enableForwarding([]string{"v4"}, func(string) ([]byte, error) { return []byte(state), nil }, func(_ string, value []byte) error { state = string(value); writes++; return nil })
	if err != nil {
		t.Fatal(err)
	}
	state = "0"
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if writes != 1 {
		t.Fatal("overwrote external state", writes)
	}
}
