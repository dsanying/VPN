// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"net"
	"strconv"
	"strings"
)

type gatewayResources struct {
	Domains  []string `json:"domains"`
	Suffixes []string `json:"suffixes"`
	CIDRs    []string `json:"cidrs"`
}

// Only explicit split resources; a default route or DNS search suffix does not establish corporate ownership.
func openConnectResources(env func(string) string) gatewayResources {
	r := gatewayResources{Domains: []string{}, CIDRs: []string{}}
	for _, d := range strings.FieldsFunc(env("CISCO_SPLIT_DNS"), func(c rune) bool { return c == ',' || c == ' ' || c == ';' }) {
		r.Suffixes = append(r.Suffixes, d)
	}
	count, _ := strconv.Atoi(env("CISCO_SPLIT_INC"))
	if count > 1024 {
		count = 1024
	}
	for i := 0; i < count; i++ {
		prefix := "CISCO_SPLIT_INC_" + strconv.Itoa(i)
		addr := net.ParseIP(env(prefix + "_ADDR")).To4()
		if addr == nil {
			continue
		}
		ones, err := strconv.Atoi(env(prefix + "_MASKLEN"))
		if err != nil {
			mask := net.ParseIP(env(prefix + "_MASK")).To4()
			if mask == nil {
				continue
			}
			ones, _ = net.IPMask(mask).Size()
		}
		if ones < 8 || ones > 32 {
			continue
		}
		network := &net.IPNet{IP: addr.Mask(net.CIDRMask(ones, 32)), Mask: net.CIDRMask(ones, 32)}
		r.CIDRs = append(r.CIDRs, network.String())
	}
	return r
}
