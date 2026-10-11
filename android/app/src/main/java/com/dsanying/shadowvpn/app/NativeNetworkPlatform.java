package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.app.NotificationManager;
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
import java.util.function.Consumer;

/** Shared physical network adapter for the VPN service and isolated exact-node probes. */
final class NativeNetworkPlatform implements PlatformInterface, AutoCloseable {
    interface SocketControl { void protect(int fd) throws Exception; }
    private final Context context;
    private final ConnectivityManager connectivity;
    private final SocketControl control;
    private final Consumer<Network> changed;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final Set<InterfaceUpdateListener> interfaceListeners = new CopyOnWriteArraySet<>();
    private volatile Network physicalNetwork;
    private LinkProperties physicalProperties;
    private Boolean physicalMetered;
    private boolean reportedNetwork;
    private static final ExecutorService dnsWorker = new ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(64), runnable -> { Thread thread = new Thread(runnable, "shadow-dns"); thread.setDaemon(true); return thread; });
    private final Set<Future<?>> dnsLookups = ConcurrentHashMap.newKeySet();
    NativeNetworkPlatform(Context context, SocketControl control, Consumer<Network> changed) {
        this.context = context.getApplicationContext();
        this.connectivity = (ConnectivityManager)this.context.getSystemService(Context.CONNECTIVITY_SERVICE);
        this.control = control;
        this.changed = changed;
    }
    @Override public void autoDetectInterfaceControl(int fd) throws Exception {
        if (control != null) { control.protect(fd); return; }
        Network network = physicalNetwork;
        if (network == null) throw new IllegalStateException("没有可用的物理网络");
        // Duplicate the descriptor only for binding; ownership remains with the native engine.
        try (ParcelFileDescriptor socket = ParcelFileDescriptor.fromFd(fd)) { network.bindSocket(socket.getFileDescriptor()); }
    }
    @Override public boolean usePlatformAutoDetectInterfaceControl() { return true; }
    @Override public int openTun(TunOptions options) { throw new UnsupportedOperationException("独立检测不能创建 VPN 隧道"); }
    @Override public synchronized void close() {
        if (networkCallback != null) {
            ConnectivityManager.NetworkCallback callback = networkCallback; networkCallback = null;
            try { connectivity.unregisterNetworkCallback(callback); } catch (IllegalArgumentException ignored) { }
        }
        physicalNetwork = null;
        physicalProperties = null; physicalMetered = null; reportedNetwork = false;
        dnsLookups.forEach(task -> task.cancel(true)); dnsLookups.clear();
        interfaceListeners.clear();
    }
    boolean hasPhysicalNetwork() {
        Network network = physicalNetwork;
        NetworkCapabilities caps = network == null ? null : connectivity.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN);
    }
    static Network findPhysicalNetwork(ConnectivityManager connectivity) {
        Network active = connectivity.getActiveNetwork();
        Network[] available = connectivity.getAllNetworks();
        Map<Network, NetworkCapabilities> observed = new HashMap<>();
        for (Network network : available) observed.put(network, connectivity.getNetworkCapabilities(network));
        if (active != null && !observed.containsKey(active)) observed.put(active, connectivity.getNetworkCapabilities(active));
        return findPhysicalNetwork(active, available, network -> {
            NetworkCapabilities caps = observed.get(network);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN);
        }, network -> observed.get(network).hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
    }
    static Network findPhysicalNetwork(Network active, Network[] available, java.util.function.Predicate<Network> physical, java.util.function.Predicate<Network> validated) {
        List<Network> candidates = new ArrayList<>();
        if (active != null) candidates.add(active);
        candidates.addAll(Arrays.asList(available));
        Network fallback = null;
        for (Network network : candidates) {
            if (physical.test(network)) {
                // The VPN can remain the system default briefly after teardown. Do not
                // select an unvalidated Wi-Fi path ahead of working mobile/Ethernet.
                if (validated.test(network)) return network;
                if (fallback == null) fallback = network;
            }
        }
        // Captive/restricted networks remain usable for local endpoints when none is validated.
        return fallback;
    }
    synchronized void startNetworkMonitor() {
        if (networkCallback != null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { updateNetwork(); }
            @Override public void onLost(Network n) { updateNetwork(); }
            @Override public void onLinkPropertiesChanged(Network n, LinkProperties p) { updateNetwork(); }
            @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { updateNetwork(); }
        };
        connectivity.registerNetworkCallback(new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build(), networkCallback);
        updateNetwork();
    }
    private synchronized void updateNetwork() {
        if (networkCallback == null) return;
        Network next = findPhysicalNetwork(connectivity);
        LinkProperties properties = next == null ? null : connectivity.getLinkProperties(next);
        boolean metered = next != null && !isUnmetered(next);
        boolean pathChanged = !reportedNetwork || !Objects.equals(physicalNetwork, next);
        boolean interfaceChanged = pathChanged || !Objects.equals(physicalProperties, properties)
            || !Objects.equals(physicalMetered, metered);
        physicalNetwork = next;
        physicalProperties = properties; // ConnectivityManager returns a parcelled snapshot; we never mutate it.
        physicalMetered = metered;
        reportedNetwork = true;
        // Updating the VPN's underlying network itself emits capability callbacks.
        // Repeat observations must not feed back into the same system mutation.
        if (pathChanged) changed.accept(next);
        if (interfaceChanged) for (InterfaceUpdateListener listener : interfaceListeners) notifyInterface(listener);
    }
    private void notifyInterface(InterfaceUpdateListener listener) {
        LinkProperties properties = physicalNetwork == null ? null : connectivity.getLinkProperties(physicalNetwork);
        String name = properties == null ? "" : properties.getInterfaceName();
        int index = -1;
        try { java.net.NetworkInterface iface = java.net.NetworkInterface.getByName(name); if (iface != null) index = iface.getIndex(); } catch (Exception ignored) { /* Unknown index remains explicit. */ }
        listener.updateDefaultInterface(name == null ? "" : name, index,
            physicalNetwork != null && !isUnmetered(physicalNetwork), false);
    }
    private boolean isUnmetered(Network network) {
        NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
    }
    @Override public LocalDNSTransport localDNSTransport() {
        return new LocalDNSTransport() {
            @Override public boolean raw() { return Build.VERSION.SDK_INT >= 29; }
            @Override public void exchange(ExchangeContext context, byte[] message) throws Exception {
                if (Build.VERSION.SDK_INT < 29) throw new UnsupportedOperationException("系统不支持原始 DNS 请求");
                Network network = physicalNetwork;
                if (network == null) throw new IllegalStateException("没有可用的物理网络");
                android.os.CancellationSignal cancel = new android.os.CancellationSignal();
                CompletableFuture<Void> finished = new CompletableFuture<>();
                context.onCancel(() -> { cancel.cancel(); finished.cancel(false); });
                DnsResolver.getInstance().rawQuery(network, message, DnsResolver.FLAG_NO_RETRY, Runnable::run, cancel,
                    new DnsResolver.Callback<byte[]>() {
                        @Override public void onAnswer(byte[] answer, int rcode) { if (!cancel.isCanceled()) { if (rcode == 0) context.rawSuccess(answer); else context.errorCode(rcode); } finished.complete(null); }
                        @Override public void onError(DnsResolver.DnsException error) { finished.completeExceptionally(error); }
                    });
                try { finished.get(20, TimeUnit.SECONDS); } finally { cancel.cancel(); }
            }
            @Override public void lookup(ExchangeContext context, String family, String domain) throws Exception {
                Network network = physicalNetwork;
                if (network == null) throw new IllegalStateException("没有可用的物理网络");
                Future<InetAddress[]> lookup;
                synchronized (NativeNetworkPlatform.this) {
                    if (networkCallback == null) throw new CancellationException();
                    lookup = dnsWorker.submit(() -> network.getAllByName(domain)); dnsLookups.add(lookup);
                }
                context.onCancel(() -> lookup.cancel(true));
                InetAddress[] resolved;
                try { resolved = lookup.get(20, TimeUnit.SECONDS); }
                finally { lookup.cancel(true); dnsLookups.remove(lookup); }
                if (!hasPhysicalNetwork()) throw new IllegalStateException("物理网络已断开");
                List<String> addresses = new ArrayList<>();
                for (InetAddress address : resolved) {
                    boolean v6 = address instanceof java.net.Inet6Address;
                    if ((!family.endsWith("4") || !v6) && (!family.endsWith("6") || v6)) addresses.add(address.getHostAddress());
                }
                if (addresses.isEmpty()) throw new java.net.UnknownHostException(domain);
                context.success(String.join("\n", addresses));
            }
        };
    }
    @Override public void startDefaultInterfaceMonitor(InterfaceUpdateListener listener) { interfaceListeners.add(listener); notifyInterface(listener); }
    @Override public void closeDefaultInterfaceMonitor(InterfaceUpdateListener listener) { interfaceListeners.remove(listener); }
    @Override public NetworkInterfaceIterator getInterfaces() throws Exception {
        List<io.nekohasekai.libbox.NetworkInterface> result = new ArrayList<>();
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
            LinkProperties properties = connectivity.getLinkProperties(network);
            if (caps == null || properties == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) continue;
            String name = properties.getInterfaceName();
            java.net.NetworkInterface actual = java.net.NetworkInterface.getByName(name);
            if (actual == null) continue;
            io.nekohasekai.libbox.NetworkInterface entry = new io.nekohasekai.libbox.NetworkInterface();
            entry.setName(name); entry.setIndex(actual.getIndex()); entry.setMTU(actual.getMTU());
            entry.setFlags(OsConstants.IFF_UP | OsConstants.IFF_RUNNING | (actual.isLoopback() ? OsConstants.IFF_LOOPBACK : 0));
            entry.setMetered(!isUnmetered(network));
            entry.setType(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? Libbox.InterfaceTypeWIFI : caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? Libbox.InterfaceTypeCellular : caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? Libbox.InterfaceTypeEthernet : Libbox.InterfaceTypeOther);
            List<String> addresses = new ArrayList<>(), dns = new ArrayList<>(), gateways = new ArrayList<>();
            for (LinkAddress address : properties.getLinkAddresses()) addresses.add(address.toString());
            for (InetAddress address : properties.getDnsServers()) dns.add(address.getHostAddress());
            for (RouteInfo route : properties.getRoutes()) if (route.getGateway() != null) gateways.add(route.getGateway().getHostAddress());
            entry.setAddresses(strings(addresses)); entry.setDNSServer(strings(dns)); entry.setGateway(strings(gateways)); result.add(entry);
        }
        Iterator<io.nekohasekai.libbox.NetworkInterface> iterator = result.iterator();
        return new NetworkInterfaceIterator() {
            public boolean hasNext() { return iterator.hasNext(); }
            public io.nekohasekai.libbox.NetworkInterface next() { return iterator.next(); }
        };
    }
    static StringIterator strings(List<String> values) {
        Iterator<String> iterator = values.iterator();
        return new StringIterator() { public boolean hasNext() { return iterator.hasNext(); } public String next() { return iterator.next(); } public int len() { return values.size(); } };
    }
    @Override public ConnectionOwner findConnectionOwner(int protocol, String source, int sourcePort, String destination, int destinationPort) throws Exception {
        if (Build.VERSION.SDK_INT < 29) throw new UnsupportedOperationException("此系统版本无法识别连接所属应用");
        int uid = connectivity.getConnectionOwnerUid(protocol, new InetSocketAddress(source, sourcePort), new InetSocketAddress(destination, destinationPort));
        if (uid < 0) throw new IllegalStateException("系统没有返回连接所属应用");
        String[] packages = context.getPackageManager().getPackagesForUid(uid);
        if (packages == null || packages.length == 0) throw new IllegalStateException("系统没有返回应用包名");
        ConnectionOwner owner = new ConnectionOwner(); owner.setUserId(uid); owner.setAndroidPackageNames(strings(Arrays.asList(packages))); return owner;
    }
    @Override public boolean useProcFS() { return false; }
    @Override public boolean underNetworkExtension() { return false; }
    @Override public boolean includeAllNetworks() { return false; }
    @Override public WIFIState readWIFIState() { return null; } // No location permission: don't fabricate SSID.
    @Override public void clearDNSCache() { /* Network-scoped resolver owns Android cache. */ }
    @Override public void registerMyInterface(String name) { /* Android owns interface naming. */ }
    @Override public String tailscaleHostname() { return "shadowvpn-android"; }
    @Override public void sendNotification(io.nekohasekai.libbox.Notification n) {
        ((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(n.getIdentifier(), n.getTypeID(), new NotificationCompat.Builder(context, "vpn").setSmallIcon(android.R.drawable.ic_lock_lock).setContentTitle(n.getTitle()).setContentText(n.getBody()).build());
    }
    @Override public void cancelNotification(String identifier, int type) { ((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(identifier, type); }
    @Override public boolean usePlatformShell() { return false; }
    @Override public boolean usePlatformBridge() { return false; }
    private UnsupportedOperationException unsupported() { return new UnsupportedOperationException("Android 应用沙箱不支持此系统能力"); }
    @Override public void checkPlatformShell() { throw unsupported(); }
    @Override public ShellSession openShellSession(PlatformUser u, String c, StringIterator e, String t, int r, int cols) { throw unsupported(); }
    @Override public PlatformUser lookupUser(String name) { throw unsupported(); }
    @Override public String lookupSFTPServer() { throw unsupported(); }
    @Override public String readSystemSSHHostKey() { throw unsupported(); }
    @Override public BridgeSession createBridge(BridgeOptions options) { throw unsupported(); }
    @Override public void startNeighborMonitor(NeighborUpdateListener listener) { throw unsupported(); }
    @Override public void closeNeighborMonitor(NeighborUpdateListener listener) { throw unsupported(); }
}
