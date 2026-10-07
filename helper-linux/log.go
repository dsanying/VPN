//go:build linux

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// 使用目录 fd 固定日志位置；只打开调用者自己的普通文件，只对本次独占创建的文件归属给调用者。
func openUserLog(name string, uid, gid uint32) (*os.File, error) {
	if !filepath.IsAbs(name) {
		return nil, fmt.Errorf("log-path-denied")
	}
	parent, err := syscall.Open(filepath.Dir(name), syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer syscall.Close(parent)
	var directory syscall.Stat_t
	if err := syscall.Fstat(parent, &directory); err != nil {
		return nil, err
	}
	if directory.Uid != uid {
		return nil, fmt.Errorf("log-directory-not-owned")
	}
	flags := syscall.O_WRONLY | syscall.O_APPEND | syscall.O_NOFOLLOW | syscall.O_NONBLOCK
	fd, err := syscall.Openat(parent, filepath.Base(name), flags|syscall.O_CREAT|syscall.O_EXCL, 0600)
	created := err == nil
	if err == syscall.EEXIST {
		fd, err = syscall.Openat(parent, filepath.Base(name), flags, 0)
	}
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), name)
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, fmt.Errorf("log-not-regular")
	}
	if created {
		if err := file.Chown(int(uid), int(gid)); err != nil {
			file.Close()
			return nil, err
		}
	} else if info.Sys().(*syscall.Stat_t).Uid != uid {
		file.Close()
		return nil, fmt.Errorf("log-file-not-owned")
	}
	return file, nil
}
