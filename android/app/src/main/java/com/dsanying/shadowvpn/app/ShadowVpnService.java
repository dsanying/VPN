package com.dsanying.shadowvpn.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.*;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.system.OsConstants;
import androidx.core.app.NotificationCompat;
import io.nekohasekai.libbox.*;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.*;

/** Android VPN ownership stays in the foreground service, never in the WebView. */
public final class ShadowVpnService extends VpnService implements PlatformInterface, CommandServerHandler {
    public static final String ACTION_STOP = "com.dsanying.shadowvpn.STOP";
    public static final String EXTRA_REQUEST = "launchRequest";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private CommandServer core;
    private ParcelFileDescriptor tun;
    private NativeNetworkPlatform platform;
    private NativeStateStore store;
    private NativeVpnJournal journal;
    private String config;
    private boolean closed;
    private String shutdownError;

    @Override public void onCreate() {
        super.onCreate();
        store = new NativeStateStore(this);
        journal = new NativeVpnJournal(store);
        platform = new NativeNetworkPlatform(this, fd -> {
            if (!protect(fd)) throw new SecurityException("无法让内核连接绕过 VPN 隧道");
        }, network -> setUnderlyingNetworks(network == null ? null : new Network[]{network}));
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            worker.execute(() -> stopExplicitly(null));
            return START_NOT_STICKY;
        }
        String request = intent == null ? null : intent.getStringExtra(EXTRA_REQUEST);
        showForeground();
        worker.execute(() -> {
            try {
                if (closed) { NativeRuntime.complete(false, "VPN 服务正在关闭，请重试"); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return; }
                if (VpnService.prepare(this) != null) throw new SecurityException("VPN 授权已失效");
                // Android's always-on and sticky restarts have no renderer or intent configuration.
                org.json.JSONObject restored = request == null ? journal.readRecord() : new NativeVpnLaunchRequest(store).consume(request);
                String requestedConfig = restored == null ? null : restored.getString("config");
                org.json.JSONObject nodes = restored == null ? new org.json.JSONObject() : restored.getJSONObject("nodes");
                if (requestedConfig == null) throw new IllegalStateException("没有可恢复的 VPN 配置，请先连接一次");
                NativeRuntime.initialize(this);
                Libbox.checkConfig(requestedConfig);
                if (!Libbox.hasTunInbound(requestedConfig)) throw new IllegalArgumentException("配置必须包含 TUN 入站");
                if (core == null) {
                    platform.startNetworkMonitor();
                    core = Libbox.newCommandServer(this, this);
                    core.start();
                }
                try (NativeVpnNetworkReady network = new NativeVpnNetworkReady(this)) {
                    core.startOrReloadService(requestedConfig, new OverrideOptions());
                    config = requestedConfig;
                    if (tun == null) throw new IllegalStateException("内核未建立 VPN 隧道");
                    network.await();
                }
                // A disk failure tears down the tunnel instead of acknowledging an unrecoverable start.
                journal.committed(requestedConfig, nodes);
                NativeRuntime.applied(requestedConfig, nodes);
                NativeRuntime.complete(true, null);
            } catch (Exception error) { stopExplicitly(error.getMessage()); }
        });
        return START_STICKY;
    }
    private void showForeground() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("vpn", "VPN 连接", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, ShadowVpnService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification notification = new NotificationCompat.Builder(this, "vpn")
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("暗影VPN")
            .setContentText("正在管理网络连接").setContentIntent(open).setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "断开", stopIntent).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, notification);
    }
    private void shutdown(String error) {
        if (closed) return;
        closed = true;
        try { if (core != null) { try { core.closeService(); } finally { core.close(); } } }
        catch (Exception closeError) { if (error == null) error = "停止内核失败：" + closeError.getMessage(); }
        finally {
            core = null;
            if (tun != null) { try { tun.close(); } catch (Exception closeError) { if (error == null) error = closeError.getMessage(); } tun = null; }
            if (platform != null) platform.close();
            shutdownError = error;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }
    private void stopExplicitly(String error) {
        try { journal.clear(); }
        catch (Exception failure) { error = "无法清理 VPN 恢复记录"; }
        finally { shutdown(error); }
    }
    @Override public void onRevoke() { worker.execute(() -> stopExplicitly("系统已撤销 VPN 授权")); }
    @Override public void onDestroy() {
        // A system lifecycle teardown retains the committed record; explicit disconnect cleared it.
        worker.execute(() -> {
            try { shutdown(null); }
            finally {
                try { if (store != null) store.close(); }
                finally { NativeRuntime.complete(false, shutdownError); }
            }
        });
        worker.shutdown();
        super.onDestroy();
    }
    @Override public void autoDetectInterfaceControl(int fd) throws Exception {
        if (!protect(fd)) throw new SecurityException("无法让内核连接绕过 VPN 隧道");
    }
    @Override public boolean usePlatformAutoDetectInterfaceControl() { return true; }
    @Override public int openTun(TunOptions options) throws Exception {
        if (prepare(this) != null) throw new SecurityException("需要 VPN 授权");
        Builder builder = new Builder().setSession("暗影VPN").setMtu(options.getMTU());
        if (Build.VERSION.SDK_INT >= 29) builder.setMetered(false);
        addAddresses(builder, options.getInet4Address()); addAddresses(builder, options.getInet6Address());
        if (options.getAutoRoute()) {
            StringIterator dns = options.getDNSServerAddress();
            while (dns.hasNext()) builder.addDnsServer(dns.next());
            // Ranges already include exclude prefixes, including on Android < 13.
            addRoutes(builder, options.getInet4RouteRange()); addRoutes(builder, options.getInet6RouteRange());
            StringIterator include = options.getIncludePackage();
            while (include.hasNext()) builder.addAllowedApplication(include.next());
            StringIterator exclude = options.getExcludePackage();
            while (exclude.hasNext()) builder.addDisallowedApplication(exclude.next());
        }
        ParcelFileDescriptor next = builder.establish();
        if (next == null) throw new SecurityException("系统未建立 VPN 隧道");
        if (tun != null) tun.close();
        tun = next;
        return next.getFd();
    }
    private static void addAddresses(Builder builder, RoutePrefixIterator iterator) {
        while (iterator.hasNext()) { RoutePrefix p = iterator.next(); builder.addAddress(p.address(), p.prefix()); }
    }
    private static void addRoutes(Builder builder, RoutePrefixIterator iterator) {
        while (iterator.hasNext()) { RoutePrefix p = iterator.next(); builder.addRoute(p.address(), p.prefix()); }
    }
    @Override public LocalDNSTransport localDNSTransport() { return platform.localDNSTransport(); }
    @Override public void startDefaultInterfaceMonitor(InterfaceUpdateListener listener) { platform.startDefaultInterfaceMonitor(listener); }
    @Override public void closeDefaultInterfaceMonitor(InterfaceUpdateListener listener) { platform.closeDefaultInterfaceMonitor(listener); }
    @Override public NetworkInterfaceIterator getInterfaces() throws Exception { return platform.getInterfaces(); }
    @Override public ConnectionOwner findConnectionOwner(int protocol, String source, int sourcePort, String destination, int destinationPort) throws Exception { return platform.findConnectionOwner(protocol, source, sourcePort, destination, destinationPort); }
    @Override public boolean useProcFS() { return platform.useProcFS(); }
    @Override public boolean underNetworkExtension() { return platform.underNetworkExtension(); }
    @Override public boolean includeAllNetworks() { return platform.includeAllNetworks(); }
    @Override public WIFIState readWIFIState() { return platform.readWIFIState(); }
    @Override public void clearDNSCache() { platform.clearDNSCache(); }
    @Override public void registerMyInterface(String name) { platform.registerMyInterface(name); }
    @Override public String tailscaleHostname() { return platform.tailscaleHostname(); }
    @Override public void sendNotification(io.nekohasekai.libbox.Notification n) { platform.sendNotification(n); }
    @Override public void cancelNotification(String identifier, int type) { platform.cancelNotification(identifier, type); }
    @Override public boolean usePlatformShell() { return platform.usePlatformShell(); }
    @Override public boolean usePlatformBridge() { return platform.usePlatformBridge(); }
    @Override public void checkPlatformShell() { platform.checkPlatformShell(); }
    @Override public ShellSession openShellSession(PlatformUser u, String c, StringIterator e, String t, int r, int cols) { return platform.openShellSession(u, c, e, t, r, cols); }
    @Override public PlatformUser lookupUser(String name) { return platform.lookupUser(name); }
    @Override public String lookupSFTPServer() { return platform.lookupSFTPServer(); }
    @Override public String readSystemSSHHostKey() { return platform.readSystemSSHHostKey(); }
    @Override public BridgeSession createBridge(BridgeOptions options) { return platform.createBridge(options); }
    @Override public void startNeighborMonitor(NeighborUpdateListener listener) { platform.startNeighborMonitor(listener); }
    @Override public void closeNeighborMonitor(NeighborUpdateListener listener) { platform.closeNeighborMonitor(listener); }
    private UnsupportedOperationException unsupported() { return new UnsupportedOperationException("Android 应用沙箱不支持此系统能力"); }
    @Override public void serviceStop() { worker.execute(() -> stopExplicitly(null)); }
    @Override public void serviceReload() throws Exception { if (core == null || config == null) throw new IllegalStateException("VPN 尚未启动"); core.startOrReloadService(config, new OverrideOptions()); }
    @Override public SystemProxyStatus getSystemProxyStatus() { SystemProxyStatus status = new SystemProxyStatus(); status.setAvailable(false); status.setEnabled(false); return status; }
    @Override public void setSystemProxyEnabled(boolean enabled) { throw unsupported(); }
    @Override public void triggerNativeCrash() { throw unsupported(); }
    @Override public int connectSSHAgent() { throw unsupported(); }
    @Override public void writeDebugMessage(String message) { android.util.Log.d("ShadowVPN", "Native diagnostic received"); }
}
