package com.dsanying.shadowvpn.app;

import android.content.Context;
import com.getcapacitor.JSObject;
import io.nekohasekai.libbox.Libbox;
import io.nekohasekai.libbox.SetupOptions;
import java.io.File;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Event completion, not polling, confirms each native command. */
final class NativeRuntime {
    private static boolean initialized;
    private static boolean running;
    private static long startedAt;
    private static String error;
    private static JSObject appliedReceipt;
    static synchronized void applied(String config, org.json.JSONObject nodes) throws Exception {
        JSObject receipt = new JSObject();
        receipt.put("configDigest", NativeStateStore.revision(config));
        receipt.put("nodes", NativeVpnJournal.validateNodes(nodes));
        appliedReceipt = receipt;
    }
    static synchronized JSObject appliedReceipt() throws Exception {
        return running && appliedReceipt != null ? JSObject.fromJSONObject(new org.json.JSONObject(appliedReceipt.toString())) : null;
    }
    private static CompletableFuture<JSObject> pending;
    private static final CopyOnWriteArraySet<Consumer<JSObject>> listeners = new CopyOnWriteArraySet<>();
    static synchronized void initialize(Context context) throws Exception {
        if (initialized) return;
        File base = new File(context.getFilesDir(), "core"), work = new File(base, "work"), temporary = new File(context.getCacheDir(), "core");
        for (File dir : new File[]{base, work, temporary}) if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("无法创建内核目录");
        go.Seq.setContext(context.getApplicationContext());
        SetupOptions options = new SetupOptions();
        options.setBasePath(base.getAbsolutePath()); options.setWorkingPath(work.getAbsolutePath()); options.setTempPath(temporary.getAbsolutePath());
        options.setFixAndroidStack(true); options.setLogMaxLines(1000); options.setDebug(false);
        options.setCommandServerSecret(Libbox.randomHex(32).getValue());
        Libbox.setup(options);
        initialized = true;
    }
    static synchronized CompletableFuture<JSObject> begin() {
        if (pending != null) throw new IllegalStateException("已有 VPN 操作正在执行");
        pending = new CompletableFuture<>();
        return pending;
    }
    static void complete(boolean active, String failure) {
        CompletableFuture<JSObject> command;
        JSObject state;
        synchronized (NativeRuntime.class) {
            if (active && !running) startedAt = System.currentTimeMillis();
            running = active; error = failure;
            if (!active) appliedReceipt = null;
            command = pending; pending = null; state = status();
        }
        if (command != null) {
            if (failure == null) command.complete(state);
            else command.completeExceptionally(new IllegalStateException(failure));
        }
        for (Consumer<JSObject> listener : listeners) {
            try { listener.accept(state); } catch (RuntimeException ignored) {
                // A detached WebView must not prevent native command completion or other subscribers.
                android.util.Log.w("ShadowVpn", "状态监听器已失效");
            }
        }
    }
    static synchronized JSObject status() {
        JSObject result = new JSObject(); result.put("running", running); result.put("busy", pending != null);
        if (running) {
            result.put("startTime", startedAt); result.put("uptime", (System.currentTimeMillis() - startedAt) / 1000);
            if (appliedReceipt != null) result.put("appliedReceipt", appliedReceipt);
        }
        if (error != null) result.put("error", error);
        return result;
    }
    static void subscribe(Consumer<JSObject> listener) { listeners.add(listener); }
    static void unsubscribe(Consumer<JSObject> listener) { listeners.remove(listener); }
}
