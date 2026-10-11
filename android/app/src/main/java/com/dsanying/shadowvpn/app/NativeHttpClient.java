package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Host transport only. Parsing, reconciliation and persistence stay in the shared business layer. */
final class NativeHttpClient {
    static final class RouteUnavailableException extends java.io.IOException {
        RouteUnavailableException(String message) { super(message); }
    }
    static final int MAX_BYTES = 10 * 1024 * 1024;
    static final int TIMEOUT_MS = 20000;
    private final ConnectivityManager networks;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    NativeHttpClient(Context context) { networks = (ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE); }
    void close() { timer.shutdownNow(); }

    static URL validateUrl(String value) throws Exception {
        URL url = new URL(value);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getHost().isEmpty() || url.getUserInfo() != null)
            throw new IllegalArgumentException("请求必须使用不含用户信息的 HTTPS 地址");
        return url;
    }
    private Network physicalNetwork() throws RouteUnavailableException {
        Network network = NativeNetworkPlatform.findPhysicalNetwork(networks);
        if (network == null) throw new RouteUnavailableException("没有可用的物理网络");
        return network;
    }
    private boolean isPhysical(Network network) {
        NetworkCapabilities c = network == null ? null : networks.getNetworkCapabilities(network);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN);
    }
    static byte[] readBounded(InputStream stream, AtomicBoolean cancelled) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int size;
            while ((size = input.read(buffer)) != -1) {
                if (cancelled.get()) throw new CancellationException("请求已取消");
                if (output.size() + size > MAX_BYTES) throw new IllegalArgumentException("响应内容体积超过上限");
                output.write(buffer, 0, size);
            }
            if (cancelled.get()) throw new CancellationException("请求已取消");
            return output.toByteArray();
        }
    }
    final class Request {
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final AtomicBoolean expired = new AtomicBoolean();
        private volatile HttpURLConnection connection;
        boolean timedOut() { return expired.get(); }
        void cancel() { cancelled.set(true); HttpURLConnection current = connection; if (current != null) current.disconnect(); }
        JSObject execute(String value, String route, String userAgent) throws Exception {
            return execute(value, route, userAgent, false);
        }
        JSObject execute(String value, String route, String userAgent, boolean headersOnly) throws Exception {
            return exchange(value, route, userAgent, headersOnly, null, MAX_BYTES, headersOnly ? 8000 : TIMEOUT_MS);
        }
        void download(String value, String route, File destination, long maximumBytes) throws Exception {
            download(value, route, destination, maximumBytes, 180000);
        }
        void download(String value, String route, File destination, long maximumBytes, int duration) throws Exception {
            if (maximumBytes < 1 || maximumBytes > 256L * 1024 * 1024) throw new IllegalArgumentException("无效下载上限");
            if (duration < 1 || duration > 180000) throw new IllegalArgumentException("无效下载时限");
            exchange(value, route, "ShadowVPN", false, destination, maximumBytes, duration);
        }
        private JSObject exchange(String value, String route, String userAgent, boolean headersOnly, File destination, long maximumBytes, int duration) throws Exception {
            URL url = validateUrl(value);
            if (!"direct".equals(route) && !"current".equals(route)) throw new IllegalArgumentException("无效请求路径");
            Network direct = "direct".equals(route) ? physicalNetwork() : null;
            long deadline = SystemClock.elapsedRealtime() + duration;
            ScheduledFuture<?> timeout = timer.schedule(() -> { expired.set(true); cancel(); }, duration, TimeUnit.MILLISECONDS);
            try {
                for (int redirects = 0; redirects <= 5; redirects++) {
                    if (cancelled.get()) throw new CancellationException("请求已取消或超时");
                    int remaining = (int)Math.max(1, deadline - SystemClock.elapsedRealtime());
                    if (direct != null && !isPhysical(direct)) throw new RouteUnavailableException("直连网络已断开");
                    connection = (HttpURLConnection)(direct == null ? url.openConnection() : direct.openConnection(url, Proxy.NO_PROXY));
                    connection.setConnectTimeout(remaining); connection.setReadTimeout(remaining);
                    connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
                    connection.setRequestMethod("GET");
                    connection.setRequestProperty("User-Agent", userAgent);
                    connection.setRequestProperty("Accept-Encoding", "identity");
                    int status = connection.getResponseCode();
                    if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                        String location = connection.getHeaderField("Location");
                        if (location == null || redirects == 5) throw new IllegalStateException("重定向无效或过多");
                        url = validateUrl(new URL(url, location).toString());
                        connection.disconnect(); connection = null;
                        continue;
                    }
                    if (!headersOnly && connection.getContentLengthLong() > maximumBytes) throw new IllegalArgumentException("响应内容体积超过上限");
                    byte[] body;
                    if (destination != null) {
                        if (status != 200) throw new java.io.IOException("下载 HTTP " + status);
                        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                            byte[] buffer = new byte[32768]; long written = 0; int size;
                            while ((size = input.read(buffer)) != -1) {
                                if (cancelled.get()) throw new CancellationException("请求已取消或超时");
                                written += size;
                                if (written > maximumBytes) throw new IllegalArgumentException("下载体积超过上限");
                                output.write(buffer, 0, size);
                            }
                            if (cancelled.get()) throw new CancellationException("请求已取消或超时");
                            if (written == 0) throw new java.io.IOException("下载内容为空");
                            output.getFD().sync();
                        }
                        body = new byte[0];
                    } else body = headersOnly ? new byte[0] : readBounded(status >= 400 ? connection.getErrorStream() : connection.getInputStream(), cancelled);
                    JSObject headers = new JSObject();
                    for (String name : new String[]{"subscription-userinfo", "etag", "last-modified", "content-type"}) {
                        String header = connection.getHeaderField(name); if (header != null) headers.put(name, header);
                    }
                    JSObject response = new JSObject(); response.put("status", status);
                    response.put("body", new String(body, StandardCharsets.UTF_8)); response.put("headers", headers);
                    return response;
                }
                throw new IllegalStateException("重定向过多");
            } finally { timeout.cancel(false); HttpURLConnection current = connection; if (current != null) current.disconnect(); connection = null; }
        }
    }
    Request request() { return new Request(); }
}
