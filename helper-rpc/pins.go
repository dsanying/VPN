package helperrpc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

// CorePins 是「允许被 install-core / install-mihomo 写入受保护目录」的二进制摘要白名单。
//
// 安全模型（SecAudit H1，用户选定的静态 pin 方案）：helper 无法区分持 token 的合法 app 与同 UID
// 攻击者——app 侧的任何凭证（staging sha、state 文件）都可被同 UID 进程伪造。唯一不可伪造的信任锚
// 是 helper 安装时从 app 安装包复制到 root 专属位置的 pins 文件（root:wheel 0444，仅 root 可写）。
// 此后 install-core / install-mihomo 只接受清单内摘要；持 token 者自备的任意二进制因摘要不在清单被拒。
//
// 功能代价（已确认接受）：官方新版内核不再免密安装——新版核摘要不在旧 pins 内，须更新 app /
// 重装 helper（一次密码框，安装脚本携带新 pins）。
//
// pins 文件格式：
//
//	{"sing-box": ["<hex64>", ...], "mihomo": ["<hex64>", ...]}
type CorePins struct {
	mu     sync.RWMutex
	values map[string][]string // 归一（小写 hex）后的摘要；key 不区分大小写
}

// NewCorePins 构造空 pin 集（LoadCorePins 失败时的降级形态：拒绝一切安装）。
func NewCorePins() *CorePins {
	return &CorePins{values: make(map[string][]string)}
}

type pinsFile struct {
	SingBox []string `json:"sing-box"`
	Mihomo  []string `json:"mihomo"`
}

// LoadCorePins 读 pins 文件。路径为空 → 空 pin 集（拒绝一切，fail-closed）；
// 文件不存在/解析失败 → 同样 fail-closed 并返回错误（调用方记日志，安装能力保持拒绝）。
func LoadCorePins(path string) (*CorePins, error) {
	pins := NewCorePins()
	if strings.TrimSpace(path) == "" {
		return pins, fmt.Errorf("pins path unset")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return pins, fmt.Errorf("read pins: %w", err)
	}
	var parsed pinsFile
	if err := json.Unmarshal(data, &parsed); err != nil {
		return pins, fmt.Errorf("parse pins: %w", err)
	}
	pins.mu.Lock()
	defer pins.mu.Unlock()
	pins.values["sing-box"] = normalizePins(parsed.SingBox)
	pins.values["mihomo"] = normalizePins(parsed.Mihomo)
	return pins, nil
}

func normalizePins(list []string) []string {
	out := make([]string, 0, len(list))
	for _, v := range list {
		v = strings.ToLower(strings.TrimSpace(v))
		if len(v) == 64 {
			out = append(out, v)
		}
	}
	return out
}

// Allows 判定 kind（"sing-box" / "mihomo"）的 digest（hex，任意大小写）是否在白名单内。
func (p *CorePins) Allows(kind, digest string) bool {
	if p == nil {
		return false
	}
	digest = strings.ToLower(strings.TrimSpace(digest))
	if len(digest) != 64 {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, pin := range p.values[strings.ToLower(strings.TrimSpace(kind))] {
		if pin == digest {
			return true
		}
	}
	return false
}

// FileDigest 计算文件 sha256（hex）。
func FileDigest(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}
