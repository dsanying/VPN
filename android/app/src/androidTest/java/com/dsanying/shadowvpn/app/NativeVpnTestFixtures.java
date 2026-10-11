package com.dsanying.shadowvpn.app;

/** Fictional direct TUN configuration shared by isolated native lifecycle tests. */
final class NativeVpnTestFixtures {
    private NativeVpnTestFixtures() {}
    static String directTunConfig() {
        return "{\"log\":{\"level\":\"warn\"},\"dns\":{\"servers\":[{\"type\":\"local\",\"tag\":\"local\"}]},\"inbounds\":[{\"type\":\"tun\",\"tag\":\"tun\",\"address\":[\"172.19.0.1/30\"],\"auto_route\":true,\"stack\":\"gvisor\"}],\"outbounds\":[{\"type\":\"direct\",\"tag\":\"direct\"}],\"route\":{\"rules\":[{\"protocol\":\"dns\",\"action\":\"hijack-dns\"}],\"final\":\"direct\",\"auto_detect_interface\":true,\"default_domain_resolver\":\"local\"}}";
    }
}
