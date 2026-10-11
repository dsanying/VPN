package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.VpnService;
import androidx.core.content.ContextCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Run seed, reboot the isolated emulator, then verify. Does not configure the OS itself. */
@RunWith(AndroidJUnit4.class)
public class NativeAlwaysOnDeviceTest {
    @Test public void systemAlwaysOnRestoresCommittedTunnelAfterBoot() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Class<?> identity = context.getClassLoader().loadClass("com.dsanying.shadowvpn.app.BuildConfig");
        assertEquals(InstrumentationRegistry.getArguments().getString("expectedCommit"), identity.getField("SOURCE_COMMIT").get(null));
        assertEquals(InstrumentationRegistry.getArguments().getString("expectedDirty"), String.valueOf(identity.getField("SOURCE_DIRTY").get(null)));
        String phase = InstrumentationRegistry.getArguments().getString("bootPhase");
        assertTrue("An explicit reboot verification phase is required", "seed".equals(phase) || "verify".equals(phase) || "cleanup".equals(phase));
        if ("cleanup".equals(phase)) {
            CompletableFuture<JSObject> stopped = NativeRuntime.begin();
            context.startService(new Intent(context, ShadowVpnService.class).setAction(ShadowVpnService.ACTION_STOP));
            assertFalse(stopped.get(30, TimeUnit.SECONDS).getBoolean("running", true));
            try (NativeStateStore store = new NativeStateStore(context)) { assertNull(new NativeVpnJournal(store).read()); }
            return;
        }
        assertNull("The dedicated emulator must authorize this application's VPN", VpnService.prepare(context));
        if ("seed".equals(phase)) {
            assertFalse("Do not replace another active tunnel", NativeRuntime.status().getBoolean("running", false));
            String config = NativeVpnTestFixtures.directTunConfig();
            String request;
            try (NativeStateStore store = new NativeStateStore(context)) {
                request = new NativeVpnLaunchRequest(store).stage(config, new org.json.JSONObject());
            }
            CompletableFuture<JSObject> started = NativeRuntime.begin();
            ContextCompat.startForegroundService(context, new Intent(context, ShadowVpnService.class)
                .putExtra(ShadowVpnService.EXTRA_REQUEST, request));
            assertTrue(started.get(30, TimeUnit.SECONDS).getBoolean("running", false));
            try (NativeStateStore store = new NativeStateStore(context)) { assertEquals(config, new NativeVpnJournal(store).read()); }
            return; // Keep the committed tunnel for an actual OS reboot, not a synthetic callback.
        }
        CompletableFuture<JSObject> restored = new CompletableFuture<>();
        Consumer<JSObject> observe = state -> { if (state.getBoolean("running", false)) restored.complete(state); };
        NativeRuntime.subscribe(observe);
        try {
            observe.accept(NativeRuntime.status());
            assertTrue("The system must start the VPN without a foreground launch", restored.get(30, TimeUnit.SECONDS).getBoolean("running", false));
            ConnectivityManager networks = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            boolean tunnel = false;
            for (android.net.Network network : networks.getAllNetworks()) {
                NetworkCapabilities caps = networks.getNetworkCapabilities(network);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) tunnel = true;
            }
            assertTrue("Boot recovery must establish an actual VPN network", tunnel);
            try (NativeStateStore store = new NativeStateStore(context)) {
                String config = new NativeVpnJournal(store).read();
                assertNotNull(config);
                assertEquals(NativeStateStore.revision(config), NativeRuntime.appliedReceipt().getString("configDigest"));
            }
            NativeHttpClient http = new NativeHttpClient(context);
            try {
                JSObject response = http.request().execute("https://www.cloudflare.com/cdn-cgi/trace", "current", "ShadowVPN-BootValidation");
                assertEquals(200, response.getInteger("status").intValue());
                assertTrue(response.getString("body").contains("ip="));
            } finally { http.close(); }
        } finally {
            NativeRuntime.unsubscribe(observe);
            if (NativeRuntime.status().getBoolean("running", false)) {
                CompletableFuture<JSObject> stopped = NativeRuntime.begin();
                context.startService(new Intent(context, ShadowVpnService.class).setAction(ShadowVpnService.ACTION_STOP));
                assertFalse(stopped.get(30, TimeUnit.SECONDS).getBoolean("running", true));
            }
        }
    }
}
