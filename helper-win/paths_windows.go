//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func finalFilePath(handle windows.Handle) (string, error) {
	buffer := make([]uint16, 32768)
	count, err := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
	if err != nil || count == 0 || count >= uint32(len(buffer)) {
		return "", fmt.Errorf("cannot resolve file handle: %v", err)
	}
	return windows.UTF16ToString(buffer[:count]), nil
}

func normalizedWindowsPath(name string) string {
	if strings.HasPrefix(name, `\\?\UNC\`) {
		name = `\\` + strings.TrimPrefix(name, `\\?\UNC\`)
	} else {
		name = strings.TrimPrefix(name, `\\?\`)
	}
	return strings.ToLower(filepath.Clean(name))
}

// Expands legitimate 8.3 names without resolving junctions or symlinks.
// The final handle path must still identify this same lexical directory.
func longWindowsPath(name string) (string, error) {
	input, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return "", err
	}
	buffer := make([]uint16, 32768)
	count, err := windows.GetLongPathName(input, &buffer[0], uint32(len(buffer)))
	if err != nil || count == 0 || count >= uint32(len(buffer)) {
		return "", fmt.Errorf("cannot expand directory name: %v", err)
	}
	return windows.UTF16ToString(buffer[:count]), nil
}

func directoryHandle(name string) (windows.Handle, error) {
	utf16, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	// 不共享删除，固定目录身份；允许客户端继续正常读写自身目录。
	return windows.CreateFile(utf16, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
}

// 固定允许目录与目标父目录，再按句柄的真实路径校验；不写日志直到校验通过。
// 配置句柄在整个 child 生命周期保持打开，禁止其被替换为 junction/symlink，仍允许客户端改写内容。
func openConfinedFile(name string, appendLog bool) (*os.File, string, error) {
	if confDir == "" || !filepath.IsAbs(confDir) || !filepath.IsAbs(name) || strings.Contains(filepath.Base(name), ":") {
		return nil, "", fmt.Errorf("path-denied")
	}
	baseHandle, err := directoryHandle(confDir)
	if err != nil {
		return nil, "", err
	}
	defer windows.CloseHandle(baseHandle)
	base, err := finalFilePath(baseHandle)
	if err != nil {
		return nil, "", err
	}
	// --confdir 本身也不能被重定向至其他目录。
	expectedBase, err := longWindowsPath(confDir)
	if err != nil {
		return nil, "", err
	}
	if normalizedWindowsPath(base) != normalizedWindowsPath(expectedBase) {
		return nil, "", fmt.Errorf("config-directory-reparse-denied")
	}
	parentHandle, err := directoryHandle(filepath.Dir(name))
	if err != nil {
		return nil, "", err
	}
	defer windows.CloseHandle(parentHandle)
	parent, err := finalFilePath(parentHandle)
	if err != nil {
		return nil, "", err
	}
	baseNormal, parentNormal := normalizedWindowsPath(base), normalizedWindowsPath(parent)
	if parentNormal != baseNormal && !strings.HasPrefix(parentNormal, baseNormal+string(os.PathSeparator)) {
		return nil, "", fmt.Errorf("path-outside-config-directory")
	}
	actual := filepath.Join(parent, filepath.Base(name))
	utf16, err := windows.UTF16PtrFromString(actual)
	if err != nil {
		return nil, "", err
	}
	access, disposition := uint32(windows.GENERIC_READ), uint32(windows.OPEN_EXISTING)
	if appendLog {
		access = windows.FILE_APPEND_DATA
		disposition = windows.OPEN_ALWAYS
	}
	handle, err := windows.CreateFile(utf16, access, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, disposition, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, "", err
	}
	file := os.NewFile(uintptr(handle), actual)
	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil || information.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || information.NumberOfLinks != 1 {
		file.Close()
		return nil, "", fmt.Errorf("file-reparse-denied")
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, "", fmt.Errorf("file-not-regular")
	}
	resolved, err := finalFilePath(handle)
	if err != nil {
		file.Close()
		return nil, "", err
	}
	if !strings.HasPrefix(normalizedWindowsPath(resolved), baseNormal+string(os.PathSeparator)) {
		file.Close()
		return nil, "", fmt.Errorf("file-outside-config-directory")
	}
	return file, resolved, nil
}
