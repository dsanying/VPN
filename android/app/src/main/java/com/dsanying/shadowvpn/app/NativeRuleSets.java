package com.dsanying.shadowvpn.app;

import android.content.Context;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import android.system.Os;
import java.util.Locale;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/** App-owned country resources. Imported configuration never supplies paths or download URLs. */
final class NativeRuleSets implements AutoCloseable {
    private final File directory;
    private final NativeHttpClient http;
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile NativeHttpClient.Request pending;
    NativeRuleSets(Context context, NativeHttpClient http) {
        this.directory = new File(context.getFilesDir(), "routing-data");
        this.http = http;
    }
    static String country(String input) {
        if (input == null || !input.matches("[A-Za-z]{2}")) throw new IllegalArgumentException("无法确认当前网络地区");
        String value = input.toUpperCase(Locale.ROOT);
        if (!Arrays.asList(Locale.getISOCountries()).contains(value)) throw new IllegalArgumentException("不支持的网络地区");
        return value.toLowerCase(Locale.ROOT);
    }
    static boolean valid(File file) {
        if (!file.isFile() || file.length() < 4 || file.length() > NativeHttpClient.MAX_BYTES) return false;
        try (FileInputStream stream = new FileInputStream(file)) {
            return stream.read() == 'S' && stream.read() == 'R' && stream.read() == 'S';
        } catch (Exception error) { return false; }
    }
    synchronized JSObject prepare(String input, boolean force) throws Exception {
        if (closed.get()) throw new IllegalStateException("分流资源已关闭");
        String code = country(input), tag = "geoip-" + code;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("无法创建分流资源目录");
        File destination = new File(directory, tag + ".srs");
        if (force || !valid(destination)) {
            File temporary = File.createTempFile(tag + "-", ".pending", directory);
            try {
                Exception failure = null;
                String url = "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/" + tag + ".srs";
                for (String route : new String[]{"direct", "current"}) {
                    if (closed.get()) throw new java.util.concurrent.CancellationException();
                    NativeHttpClient.Request request = http.request(); pending = request;
                    try {
                        request.download(url, route, temporary, NativeHttpClient.MAX_BYTES, 20000);
                        if (!valid(temporary)) throw new java.io.IOException("分流资源格式无效");
                        if (closed.get()) throw new java.util.concurrent.CancellationException();
                        Os.rename(temporary.getAbsolutePath(), destination.getAbsolutePath());
                        failure = null; break;
                    } catch (Exception error) { failure = error; }
                    finally { pending = null; }
                }
                if (failure != null) throw failure;
            } finally { if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit(); }
        }
        JSObject result = new JSObject(); result.put("tag", tag); result.put("path", destination.getAbsolutePath()); result.put("format", "binary");
        return result;
    }
    @Override public void close() { closed.set(true); NativeHttpClient.Request request = pending; if (request != null) request.cancel(); }
}
