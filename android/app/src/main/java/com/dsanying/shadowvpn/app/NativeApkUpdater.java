package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import java.io.*;
import java.net.URI;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONArray;
import org.json.JSONObject;

/** Transport mirrors cannot change publisher identity, APK digest, application ID, or signing identity. */
final class NativeApkUpdater {
    private static final String DOCUMENT = "native.update.apk";
    private static final Set<String> MIRRORS = new HashSet<>(Arrays.asList("https://gh-proxy.org/", "https://ghproxy.net/", "https://v4.gh-proxy.org/", "https://cdn.gh-proxy.org/"));
    private final Context context;
    private final NativeHttpClient http;
    private final NativeStateStore store;
    private volatile NativeHttpClient.Request active;
    private volatile boolean closed;
    NativeApkUpdater(Context context, NativeHttpClient http, NativeStateStore store) { this.context = context; this.http = http; this.store = store; }
    void close() { closed = true; NativeHttpClient.Request request = active; if (request != null) request.cancel(); }
    // Destruction must wait for a cancelled download to leave its database commit section.
    synchronized void awaitIdle() {}
    static int remainingDownloadTime(long deadline, long now) throws IOException {
        long remaining = deadline - now;
        if (remaining <= 0) throw new IOException("软件更新下载已超时");
        return (int)Math.min(180000, remaining);
    }
    static void validateAsset(String url, String version, String digest) throws Exception {
        if (version == null || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+") || digest == null || !digest.matches("sha256:[a-fA-F0-9]{64}")) throw new IllegalArgumentException("无效发布凭据");
        URI uri = new URI(url);
        String prefix = "/dsanying/VPN/releases/download/v" + version + "/";
        String pathname = uri.getPath();
        if (!"https".equals(uri.getScheme()) || !"github.com".equals(uri.getHost()) || uri.getPort() != -1 || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !pathname.startsWith(prefix)) throw new IllegalArgumentException("无效软件发布源");
        String name = pathname.substring(prefix.length());
        if (!name.endsWith(".apk") || name.length() <= 4 || name.contains("/") || name.contains("\\") || name.contains("\u0000")) throw new IllegalArgumentException("无效 APK 文件名");
    }
    static boolean transportAllowed(String source, String candidate) {
        if (source.equals(candidate)) return true;
        for (String prefix : MIRRORS) if ((prefix + source).equals(candidate)) return true;
        return false;
    }
    private File directory() throws IOException {
        File dir = new File(context.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建更新目录");
        return dir;
    }
    static String digest(File file) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) { byte[] buffer = new byte[32768]; int size; while ((size = input.read(buffer)) != -1) hash.update(buffer, 0, size); }
        StringBuilder result = new StringBuilder(); for (byte value : hash.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return "sha256:" + result;
    }
    private void verify(File file, String version, String expected) throws Exception {
        if (!file.isFile() || file.length() <= 0 || file.length() > 256L * 1024 * 1024 || !MessageDigest.isEqual(digest(file).getBytes(java.nio.charset.StandardCharsets.US_ASCII), expected.toLowerCase(Locale.ROOT).getBytes(java.nio.charset.StandardCharsets.US_ASCII))) throw new SecurityException("软件更新摘要不匹配");
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(), flags);
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (candidate == null || !context.getPackageName().equals(candidate.packageName) || !version.equals(candidate.versionName)) throw new SecurityException("更新应用或版本不匹配");
        long currentCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        long nextCode = Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode;
        if (nextCode <= currentCode) throw new SecurityException("禁止安装旧版或同版更新");
        if (Build.VERSION.SDK_INT >= 28 && (installed.signingInfo == null || candidate.signingInfo == null)) throw new SecurityException("无法核实软件签名");
        Signature[] current = Build.VERSION.SDK_INT >= 28 ? installed.signingInfo.getApkContentsSigners() : installed.signatures;
        Signature[] incoming = Build.VERSION.SDK_INT >= 28 ? candidate.signingInfo.getApkContentsSigners() : candidate.signatures;
        if (current == null || incoming == null || current.length == 0 || current.length != incoming.length || !new HashSet<>(Arrays.asList(current)).equals(new HashSet<>(Arrays.asList(incoming)))) throw new SecurityException("更新签名与已安装软件不一致");
    }
    synchronized JSObject prepare(String url, String version, String expected, JSONArray candidates) throws Exception {
        validateAsset(url, version, expected);
        if (closed) throw new IllegalStateException("更新已取消");
        File dir = directory(), ready = new File(dir, expected.substring(7).toLowerCase(Locale.ROOT) + ".apk");
        if (ready.isFile()) { try { verify(ready, version, expected); return remember(url, version, expected); } catch (Exception invalid) { if (!ready.delete()) throw new IOException("无法清理旧更新文件"); } }
        if (candidates == null || candidates.length() < 1 || candidates.length() > MIRRORS.size() + 1) throw new IllegalArgumentException("无效下载路径");
        for (int i = 0; i < candidates.length(); i++) if (!transportAllowed(url, candidates.getString(i))) throw new SecurityException("未授权下载镜像");
        Exception failure = null;
        // All mirrors and both routes share a five-minute budget, including redirects.
        long deadline = SystemClock.elapsedRealtime() + 300000;
        for (int i = 0; i < candidates.length(); i++) for (String route : new String[]{"current", "direct"}) {
            if (closed) throw new IllegalStateException("更新已取消");
            int remaining = remainingDownloadTime(deadline, SystemClock.elapsedRealtime());
            File temporary = File.createTempFile("download-", ".part", dir);
            try {
                NativeHttpClient.Request request = http.request(); active = request;
                if (closed) request.cancel();
                request.download(candidates.getString(i), route, temporary, 256L * 1024 * 1024, remaining);
                verify(temporary, version, expected);
                if (closed) throw new IllegalStateException("更新已取消");
                if (!temporary.renameTo(ready)) throw new IOException("无法保存更新文件");
                return remember(url, version, expected);
            } catch (SecurityException unsafe) { throw unsafe; }
            catch (Exception error) { failure = error; }
            finally { active = null; if (temporary.exists()) temporary.delete(); }
        }
        throw new IOException("全部软件更新下载路径失败", failure);
    }
    private JSObject remember(String url, String version, String expected) throws Exception {
        if (closed) throw new IllegalStateException("更新已取消");
        JSONObject record = new JSONObject(); record.put("url", url); record.put("version", version); record.put("digest", expected.toLowerCase(Locale.ROOT));
        store.write(DOCUMENT, record.toString());
        File[] files = directory().listFiles(); String retained = expected.substring(7).toLowerCase(Locale.ROOT) + ".apk";
        if (files != null) for (File file : files) if (!file.getName().equals(retained) && (file.getName().endsWith(".apk") || file.getName().endsWith(".part"))) file.delete();
        JSObject result = new JSObject(); result.put("version", version); result.put("verified", true); return result;
    }
    synchronized JSObject cached() throws Exception {
        String content = store.read(DOCUMENT);
        if (content == null) return null;
        try {
            JSONObject record = new JSONObject(content);
            String version = record.getString("version"), expected = record.getString("digest");
            validateAsset(record.getString("url"), version, expected);
            verify(new File(directory(), expected.substring(7).toLowerCase(Locale.ROOT) + ".apk"), version, expected);
            JSObject result = new JSObject(); result.put("version", version); result.put("verified", true); return result;
        } catch (Exception stale) {
            // Missing, changed, malformed, or already applied artifacts cannot remain actionable.
            store.delete(DOCUMENT);
            File[] files = directory().listFiles();
            if (files != null) for (File file : files) if (file.getName().matches("[a-f0-9]{64}\\.apk") || file.getName().endsWith(".part")) file.delete();
            return null;
        }
    }
    synchronized JSObject install() throws Exception {
        String content = store.read(DOCUMENT);
        if (content == null) throw new IllegalStateException("没有已验证的软件更新");
        JSONObject record = new JSONObject(content);
        String version = record.getString("version"), expected = record.getString("digest");
        validateAsset(record.getString("url"), version, expected);
        File file = new File(directory(), expected.substring(7).toLowerCase(Locale.ROOT) + ".apk");
        verify(file, version, expected);
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
            context.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            result.put("permissionRequired", true); return result;
        }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        context.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION));
        result.put("installationRequested", true); return result;
    }
}
