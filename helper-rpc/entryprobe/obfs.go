package entryprobe

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"golang.org/x/crypto/blake2b"
)

type Obfs struct {
	Type          string `json:"type"`
	Password      string `json:"password"`
	MinPacketSize int    `json:"minPacketSize,omitempty"`
	MaxPacketSize int    `json:"maxPacketSize,omitempty"`
}

func (o *Obfs) valid() bool {
	if o == nil {
		return true
	}
	if (o.Type != "salamander" && o.Type != "gecko") || len(o.Password) == 0 || len(o.Password) > 1024 {
		return false
	}
	min, max := o.packetSizes()
	return min >= 64 && max >= min && max <= 2048 && max >= 163
}
func (o *Obfs) packetSizes() (int, int) {
	min, max := o.MinPacketSize, o.MaxPacketSize
	if min == 0 {
		min = 512
	}
	if max == 0 {
		max = 1200
	}
	return min, max
}
func salamander(packet []byte, password string) ([]byte, error) {
	salt := make([]byte, 8)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	key := blake2b.Sum256(append([]byte(password), salt...))
	result := append(salt, make([]byte, len(packet))...)
	for i, b := range packet {
		result[8+i] = b ^ key[i%32]
	}
	return result, nil
}
func deSalamander(packet []byte, password string) []byte {
	if len(packet) <= 8 {
		return nil
	}
	key := blake2b.Sum256(append([]byte(password), packet[:8]...))
	result := make([]byte, len(packet)-8)
	for i := range result {
		result[i] = packet[i+8] ^ key[i%32]
	}
	return result
}
func obfuscate(packet []byte, o *Obfs) ([][]byte, error) {
	if o == nil {
		return [][]byte{packet}, nil
	}
	if o.Type == "salamander" {
		p, e := salamander(packet, o.Password)
		return [][]byte{p}, e
	}
	min, max := o.packetSizes()
	payloadMax := max - 13
	count := (len(packet) + payloadMax - 1) / payloadMax
	if count < 2 {
		count = 2
	}
	if count > 8 {
		return nil, errors.New("fragment limit")
	}
	id := make([]byte, 1)
	if _, err := rand.Read(id); err != nil {
		return nil, err
	}
	packets := make([][]byte, 0, count)
	for i := 0; i < count; i++ {
		chunk := packet[len(packet)*i/count : len(packet)*(i+1)/count]
		padding := min - 13 - len(chunk)
		if padding < 0 {
			padding = 0
		}
		frame := make([]byte, 5+padding+len(chunk))
		frame[0], frame[1], frame[2] = 0x80, id[0], byte(i<<4|count)
		binary.BigEndian.PutUint16(frame[3:5], uint16(padding))
		if _, err := rand.Read(frame[5 : 5+padding]); err != nil {
			return nil, err
		}
		copy(frame[5+padding:], chunk)
		p, err := salamander(frame, o.Password)
		if err != nil {
			return nil, err
		}
		packets = append(packets, p)
	}
	return packets, nil
}

type fragments struct {
	total  int
	chunks [8][]byte
	size   int
}
type deobfuscator struct {
	obfs     *Obfs
	messages map[byte]*fragments
}

func (d *deobfuscator) decode(packet []byte) []byte {
	if d.obfs == nil {
		return packet
	}
	packet = deSalamander(packet, d.obfs.Password)
	if d.obfs.Type != "gecko" {
		return packet
	}
	if len(packet) == 0 {
		return nil
	}
	if packet[0]&0x80 == 0 {
		return packet
	}
	if len(packet) < 5 || packet[0] != 0x80 {
		return nil
	}
	index, total := int(packet[2]>>4), int(packet[2]&15)
	padding := int(binary.BigEndian.Uint16(packet[3:5]))
	if total < 2 || total > 8 || index >= total || 5+padding >= len(packet) {
		return nil
	}
	if d.messages == nil {
		d.messages = make(map[byte]*fragments)
	}
	id := packet[1]
	message := d.messages[id]
	if message == nil {
		if len(d.messages) >= 16 {
			return nil
		}
		message = &fragments{total: total}
		d.messages[id] = message
	}
	if message.total != total {
		delete(d.messages, id)
		return nil
	}
	if message.chunks[index] != nil {
		return nil
	}
	chunk := packet[5+padding:]
	if message.size+len(chunk) > 4096 {
		delete(d.messages, id)
		return nil
	}
	message.chunks[index] = append([]byte(nil), chunk...)
	message.size += len(chunk)
	for i := 0; i < total; i++ {
		if message.chunks[i] == nil {
			return nil
		}
	}
	result := make([]byte, 0, message.size)
	for i := 0; i < total; i++ {
		result = append(result, message.chunks[i]...)
	}
	delete(d.messages, id)
	return result
}
