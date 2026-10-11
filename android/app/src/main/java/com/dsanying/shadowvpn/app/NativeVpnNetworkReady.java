package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Process;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** A native core start is acknowledged only after Android exposes this application's VPN. */
final class NativeVpnNetworkReady implements AutoCloseable {
    private final ConnectivityManager manager;
    private final CompletableFuture<Network> ready = new CompletableFuture<>();
    private final ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
            if (owned(capabilities)) ready.complete(network);
        }
    };
    NativeVpnNetworkReady(Context context) {
        manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        manager.registerNetworkCallback(new NetworkRequest.Builder()
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .addTransportType(NetworkCapabilities.TRANSPORT_VPN).build(), callback);
    }
    private boolean owned(NetworkCapabilities capabilities) {
        return capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
            && (Build.VERSION.SDK_INT < 30 || capabilities.getOwnerUid() == Process.myUid());
    }
    void await() throws Exception {
        Network network = ready.get(10, TimeUnit.SECONDS);
        if (!owned(manager.getNetworkCapabilities(network)))
            throw new IllegalStateException("系统 VPN 网络尚未就绪");
    }
    @Override public void close() { manager.unregisterNetworkCallback(callback); }
}
