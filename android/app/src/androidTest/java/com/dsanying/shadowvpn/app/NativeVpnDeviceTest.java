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
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Requires VPN authorization on a dedicated test device; never alters a user's configuration. */
@RunWith(AndroidJUnit4.class)
public class NativeVpnDeviceTest {
    @Test public void establishesActualTunnelTransfersHttpsAndExplicitStopRemovesRecovery() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertNull("Authorize this application as VPN on the isolated test device first", VpnService.prepare(context));
        NativeRuntime.initialize(context);
        assertFalse("A test must not replace an existing tunnel", NativeRuntime.status().getBoolean("running", false));
        String config = NativeVpnTestFixtures.directTunConfig();
        CompletableFuture<JSObject> started = NativeRuntime.begin();
        try {
            ContextCompat.startForegroundService(context, new Intent(context, ShadowVpnService.class)
                .putExtra(ShadowVpnService.EXTRA_REQUEST, stage(context,config)));
            assertTrue(started.get(30, TimeUnit.SECONDS).getBoolean("running", false));
            ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            boolean tunnel = false;
            for (android.net.Network network : manager.getAllNetworks()) {
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) tunnel = true;
            }
            assertTrue("A running receipt requires an actual system VPN network", tunnel);
            assertEquals(NativeStateStore.revision(config), NativeRuntime.appliedReceipt().getString("configDigest"));
            NativeHttpClient transport = new NativeHttpClient(context);
            try {
                JSObject response = transport.request().execute("https://www.cloudflare.com/cdn-cgi/trace", "current", "ShadowVPN-DeviceValidation");
                assertEquals(200, response.getInteger("status").intValue());
                assertTrue(response.getString("body").contains("ip="));
            } finally { transport.close(); }
            try (NativeStateStore store = new NativeStateStore(context())) {
                assertEquals(config, new NativeVpnJournal(store).read());
            }
            for (int cycle = 0; cycle < 3; cycle++) {
                CompletableFuture<JSObject> stopped = NativeRuntime.begin();
                context.startService(new Intent(context, ShadowVpnService.class).setAction(ShadowVpnService.ACTION_STOP));
                assertFalse(stopped.get(30, TimeUnit.SECONDS).getBoolean("running", true));
                CompletableFuture<JSObject> restarted = NativeRuntime.begin();
                ContextCompat.startForegroundService(context, new Intent(context, ShadowVpnService.class)
                    .putExtra(ShadowVpnService.EXTRA_REQUEST, stage(context,config)));
                assertTrue(restarted.get(30, TimeUnit.SECONDS).getBoolean("running", false));
            }
        } finally {
            if (NativeRuntime.status().getBoolean("running", false)) {
                if (!NativeRuntime.status().getBoolean("busy", false)) {
                    CompletableFuture<JSObject> stopped = NativeRuntime.begin();
                    context.startService(new Intent(context, ShadowVpnService.class).setAction(ShadowVpnService.ACTION_STOP));
                    assertFalse(stopped.get(30, TimeUnit.SECONDS).getBoolean("running", true));
                } else {
                    // Preserve the original timed-out assertion instead of hiding it with a second reservation.
                    context.stopService(new Intent(context, ShadowVpnService.class));
                }
            }
        }
        try (NativeStateStore store = new NativeStateStore(context)) { assertNull(new NativeVpnJournal(store).read()); }
    }
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private String stage(Context context,String config) throws Exception {
        try(NativeStateStore store=new NativeStateStore(context)){return new NativeVpnLaunchRequest(store).stage(config,new org.json.JSONObject());}
    }
}
