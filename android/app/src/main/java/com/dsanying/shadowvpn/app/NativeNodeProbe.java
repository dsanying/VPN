package com.dsanying.shadowvpn.app;

import android.content.Context;
import com.getcapacitor.JSObject;
import io.nekohasekai.libbox.AndroidNodeProbe;
import io.nekohasekai.libbox.AndroidProbeResult;
import io.nekohasekai.libbox.Libbox;
import java.util.concurrent.CancellationException;

/** Per-request lifetime; cancellation never stops the active VPN or another probe. */
final class NativeNodeProbe {
    private AndroidNodeProbe active;
    private boolean cancelled;
    synchronized void cancel() { cancelled = true; if (active != null) active.cancel(); }
    JSObject execute(Context context, String config, String tag, String target, String address, int port) throws Exception {
        NativeRuntime.initialize(context);
        long started = System.currentTimeMillis();
        try (NativeNetworkPlatform platform = new NativeNetworkPlatform(context, null, network -> {})) {
            platform.startNetworkMonitor();
            if (!platform.hasPhysicalNetwork()) throw new IllegalStateException("物理网络不可用");
            synchronized (this) {
                if (cancelled) throw new CancellationException();
                active = Libbox.newAndroidNodeProbe(platform);
            }
            try {
                AndroidProbeResult result = active.run(config, tag, target, address, port);
                synchronized (this) { if (cancelled) throw new CancellationException(); }
                if (!platform.hasPhysicalNetwork()) throw new IllegalStateException("物理网络已断开");
                JSObject entry = new JSObject();
                entry.put("status", result.getEntryLatencyMS() >= 0 ? "ok" : "timeout".equals(result.getEntryFailure()) ? "timeout" : "failed");
                if (result.getEntryLatencyMS() >= 0) entry.put("latencyMs", result.getEntryLatencyMS());
                if (!result.getEntryFailure().isEmpty()) entry.put("reason", result.getEntryFailure());
                JSObject detail = new JSObject(); detail.put("entry", entry); detail.put("proxyTarget", target);
                if (!result.getFailure().isEmpty()) detail.put("proxyReason", result.getFailure());
                JSObject value = new JSObject(); value.put("latency", result.getLatencyMS()); value.put("testedAt", started); value.put("detail", detail); value.put("body", result.getBody()); value.put("status", result.getStatusCode());
                return value;
            } finally { synchronized (this) { active.cancel(); active = null; } }
        }
    }
}
