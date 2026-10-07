//go:build !windows

package main

// This harness runs the actual helper command/lifecycle code on a Unix CI host.
// Windows API calls are replaced below; SCM, console signals and IP tables require Windows validation.
import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"shadowvpn/helperrpc"
	"strings"
	"syscall"
	"testing"
	"time"
)

var testListeningPIDs []uint32

func sendCtrlBreak(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(os.Interrupt)
}
func processAlive(pid int) bool                  { return syscall.Kill(pid, 0) != syscall.ESRCH }
func listenPidsForPort(uint16) ([]uint32, error) { return testListeningPIDs, nil }
func enableIPForwarding() (func() error, error)  { return func() error { return nil }, nil }
func startSingbox(string, string, string) (*exec.Cmd, *os.File, *os.File, error) {
	return nil, nil, nil, errors.New("not used in portable lifecycle harness")
}
func spawnSelfUninstall() {}

func TestPortableSlowChild(t *testing.T) {
	if os.Getenv("SHADOW_PORTABLE_CHILD") != "1" {
		return
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	fmt.Println("ready")
	<-signals
	time.Sleep(250 * time.Millisecond)
	os.Exit(0)
}

func startPortableChild(t *testing.T) *exec.Cmd {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=TestPortableSlowChild")
	command.Env = append(os.Environ(), "SHADOW_PORTABLE_CHILD=1")
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 6)
	if _, err := stdout.Read(buf); err != nil {
		command.Process.Kill()
		t.Fatal(err)
	}
	t.Cleanup(func() { command.Process.Kill() })
	return command
}

func managePortableChild(command *exec.Cmd, afterExit func()) <-chan struct{} {
	done := make(chan struct{})
	mu.Lock()
	child = command
	childDone = done
	stopping = false
	shuttingDown = false
	mu.Unlock()
	go func() {
		command.Wait()
		if afterExit != nil {
			afterExit()
		}
		mu.Lock()
		child = nil
		childDone = nil
		stopping = false
		close(done)
		mu.Unlock()
	}()
	return done
}

func TestPortableCleanupProtectsForeignAndKeepsStoppingUntilRestore(t *testing.T) {
	foreign := startPortableChild(t)
	defer func() { foreign.Process.Kill(); foreign.Wait() }()
	owned := startPortableChild(t)
	restored := make(chan struct{})
	allowRestore := make(chan struct{})
	done := managePortableChild(owned, func() { close(restored); <-allowRestore })
	defer func() { close(allowRestore); <-done }()
	testListeningPIDs = []uint32{uint32(foreign.Process.Pid)}
	response := executeCommand(context.Background(), "freeport", &helperrpc.Arguments{Values: []string{"9090"}})
	if !strings.HasPrefix(response, "OK foreign ") {
		t.Fatal(response)
	}
	response = executeCommand(context.Background(), "cleanup", &helperrpc.Arguments{})
	if !strings.HasPrefix(response, "OK stopping ") {
		t.Fatal(response)
	}
	select {
	case <-restored:
	case <-time.After(3 * time.Second):
		t.Fatal("child did not exit")
	}
	response = executeCommand(context.Background(), "status", &helperrpc.Arguments{})
	if !strings.HasPrefix(response, "OK stopping ") {
		t.Fatal("restoration window lost", response)
	}
	response = executeCommand(context.Background(), "start", &helperrpc.Arguments{})
	if response != "ERR stopping" {
		t.Fatal("overlapping start", response)
	}
	if err := syscall.Kill(foreign.Process.Pid, 0); err != nil {
		t.Fatal("foreign process killed", err)
	}
}

func TestPortableShutdownRejectsNewStart(t *testing.T) {
	mu.Lock()
	child = nil
	childDone = nil
	shuttingDown = false
	mu.Unlock()
	reapChildOnExit()
	response := executeCommand(context.Background(), "start", &helperrpc.Arguments{})
	if response != "ERR shutting-down" {
		t.Fatal(response)
	}
	mu.Lock()
	shuttingDown = false
	mu.Unlock()
}

func openConfinedFile(name string, _ bool) (*os.File, string, error) {
	file, err := os.Open(name)
	return file, name, err
}
