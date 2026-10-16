// SPDX-License-Identifier: AGPL-3.0-only
package main

import "testing"

func TestSplitResources(t *testing.T) {
	values := map[string]string{"CISCO_SPLIT_INC": "3", "CISCO_SPLIT_INC_0_ADDR": "10.2.3.4", "CISCO_SPLIT_INC_0_MASKLEN": "16", "CISCO_SPLIT_INC_1_ADDR": "0.0.0.0", "CISCO_SPLIT_INC_1_MASKLEN": "0", "CISCO_SPLIT_INC_2_ADDR": "172.16.1.9", "CISCO_SPLIT_INC_2_MASK": "255.255.255.0", "CISCO_SPLIT_DNS": "internal.example.com,private.example.com", "CISCO_DEF_DOMAIN": "example.org"}
	r := openConnectResources(func(k string) string { return values[k] })
	if len(r.CIDRs) != 2 || r.CIDRs[0] != "10.2.0.0/16" || r.CIDRs[1] != "172.16.1.0/24" || len(r.Suffixes) != 2 {
		t.Fatalf("unexpected resources: %+v", r)
	}
	if len(openConnectResources(func(string) string { return "" }).CIDRs) != 0 {
		t.Fatal("must not guess routes")
	}
}
