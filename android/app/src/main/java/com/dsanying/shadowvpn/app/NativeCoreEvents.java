package com.dsanying.shadowvpn.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import io.nekohasekai.libbox.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Demand-owned authenticated libbox streams, with no WebView status polling. */
final class NativeCoreEvents implements AutoCloseable {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Consumer<JSObject> publish;
    private final Consumer<JSObject> statusListener = status -> refresh();
    private Set<String> topics = new HashSet<>();
    private CommandClient client;
    private CommandClient logClient;
    private volatile long logGeneration;
    private volatile long generation;
    private volatile boolean closed;
    NativeCoreEvents(Consumer<JSObject> publish) { this.publish = publish; NativeRuntime.subscribe(statusListener); }
    synchronized void setTopics(Set<String> requested) {
        if (closed) throw new IllegalStateException("内核事件已关闭");
        if (!new HashSet<>(Arrays.asList("stats", "connections", "logs", "outbounds")).containsAll(requested)) throw new IllegalArgumentException("未知内核事件类型");
        if (topics.equals(requested)) return;
        topics = new HashSet<>(requested); refresh();
    }
    private synchronized void refresh() {
        if (closed) return;
        Set<String> requested = new HashSet<>(topics);
        long revision = ++generation;
        worker.execute(() -> {
            disconnect();
            if (closed || revision != generation) return;
            boolean running = NativeRuntime.status().getBoolean("running", false);
            if (!running || !requested.contains("logs")) disconnectLogs();
            else if (logClient == null) {
                try {
                    CommandClientOptions options = new CommandClientOptions(); options.addCommand(Libbox.CommandLog);
                    logClient = Libbox.newCommandClient(new Handler(++logGeneration, true), options); logClient.connect();
                } catch (Exception failure) { disconnectLogs(); emit(revision, false, "streamError", new JSObject().put("message", "无法订阅内核日志")); }
            }
            if (!running || requested.stream().allMatch(topic -> topic.equals("logs"))) return;
            try {
                CommandClientOptions options = new CommandClientOptions(); options.setStatusInterval(1_000_000_000L);
                if (requested.contains("stats")) options.addCommand(Libbox.CommandStatus);
                if (requested.contains("connections")) options.addCommand(Libbox.CommandConnections);
                if (requested.contains("outbounds")) options.addCommand(Libbox.CommandOutbounds);
                client = Libbox.newCommandClient(new Handler(revision, false), options); client.connect();
            } catch (Exception failure) { emit(revision, false, "streamError", new JSObject().put("message", "无法订阅内核事件")); disconnect(); }
        });
    }
    private void disconnectLogs() {
        logGeneration++;
        if (logClient != null) { try { logClient.disconnect(); } catch (Exception ignored) { } logClient = null; }
    }

    private void disconnect() {
        if (client != null) { try { client.disconnect(); } catch (Exception ignored) { /* Already disconnected. */ } client = null; }
    }
    private void emit(long revision, boolean logging, String topic, Object data) {
        if (closed || revision != (logging ? logGeneration : generation)) return;
        JSObject event = new JSObject(); event.put("topic", topic); event.put("data", data);
        try { publish.accept(event); } catch (RuntimeException ignored) { /* A detached view cannot interrupt the core stream. */ }
    }
    @Override public synchronized void close() {
        if (closed) return;
        closed = true; generation++; logGeneration++; NativeRuntime.unsubscribe(statusListener);
        worker.execute(() -> { disconnect(); disconnectLogs(); }); worker.shutdown();
    }
    private final class Handler implements CommandClientHandler {
        private final long revision;
        private final boolean logging;
        Handler(long revision, boolean logging) { this.revision = revision; this.logging = logging; }
        private void emit(long revision, String topic, Object data) { NativeCoreEvents.this.emit(revision, logging, topic, data); }
        @Override public void connected() { emit(revision, "connected", new JSObject()); }
        @Override public void disconnected(String reason) { emit(revision, "streamError", new JSObject().put("message", "内核事件连接已断开")); }
        @Override public void setDefaultLogLevel(int level) {}
        @Override public void initializeClashMode(StringIterator modes, String current) {}
        @Override public void updateClashMode(String mode) {}
        @Override public void writeGroups(OutboundGroupIterator groups) {}
        @Override public void clearLogs() { emit(revision, "logsReset", new JSObject()); }
        @Override public void writeStatus(StatusMessage status) {
            JSObject value = new JSObject();
            value.put("uploadSpeed", status.getUplink()); value.put("downloadSpeed", status.getDownlink());
            value.put("uploadTotal", status.getUplinkTotal()); value.put("downloadTotal", status.getDownlinkTotal());
            value.put("connectionCount", status.getConnectionsOut()); value.put("trafficAvailable", status.getTrafficAvailable());
            emit(revision, "stats", value);
        }
        @Override public void writeLogs(LogIterator logs) {
            JSArray values = new JSArray();
            while (logs.hasNext()) { LogEntry log = logs.next(); JSObject value = new JSObject(); value.put("level", log.getLevel()); value.put("message", log.getMessage()); values.put(value); }
            emit(revision, "logs", values);
        }
        @Override public void writeOutbounds(OutboundGroupItemIterator outbounds) {
            JSArray values = new JSArray();
            while (outbounds.hasNext()) { OutboundGroupItem item = outbounds.next(); JSObject value = new JSObject(); value.put("tag", item.getTag()); value.put("type", item.getType()); value.put("checkedAt", item.getURLTestTime()); value.put("latency", item.getURLTestDelay()); values.put(value); }
            emit(revision, "outbounds", values);
        }
        @Override public void writeConnectionEvents(ConnectionEvents events) {
            JSArray values = new JSArray(); ConnectionEventIterator iterator = events.iterator();
            while (iterator.hasNext()) {
                ConnectionEvent item = iterator.next(); JSObject value = new JSObject();
                value.put("type", item.getType()); value.put("id", item.getID());
                value.put("uploadDelta", item.getUplinkDelta()); value.put("downloadDelta", item.getDownlinkDelta()); value.put("closedAt", item.getClosedAt());
                Connection connection = item.getConnection();
                if (connection != null) {
                    JSObject detail = new JSObject(); detail.put("source", connection.getSource()); detail.put("destination", connection.getDestination());
                    detail.put("domain", connection.getDomain()); detail.put("network", connection.getNetwork()); detail.put("protocol", connection.getProtocol());
                    detail.put("outbound", connection.getOutbound()); detail.put("rule", connection.getRule()); detail.put("createdAt", connection.getCreatedAt());
                    detail.put("uploadTotal", connection.getUplinkTotal()); detail.put("downloadTotal", connection.getDownlinkTotal());
                    ProcessInfo process = connection.getProcessInfo();
                    if (process != null) { JSArray packages = new JSArray(); StringIterator names = process.packageNames(); while (names.hasNext()) packages.put(names.next()); detail.put("packages", packages); detail.put("uid", process.getUserID()); }
                    value.put("connection", detail);
                }
                values.put(value);
            }
            JSObject data = new JSObject(); data.put("reset", events.getReset()); data.put("events", values); emit(revision, "connections", data);
        }
    }
}
