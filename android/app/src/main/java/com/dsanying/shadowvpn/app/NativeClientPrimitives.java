package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import io.nekohasekai.libbox.Libbox;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Application-owned primitives; an Activity only supplies explicitly foreground operations. */
final class NativeClientPrimitives implements AutoCloseable {
    interface Foreground { CompletableFuture<JSObject> invoke(String method, JSObject data); }
    private static NativeClientPrimitives instance;
    static synchronized NativeClientPrimitives get(Context context) {
        if (instance == null) instance = new NativeClientPrimitives(context.getApplicationContext());
        return instance;
    }
    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService networkWorker = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(32));
    private final NativeStateStore store;
    private final NativeHttpClient http;
    private final NativeApkUpdater updater;
    private final NativeRuleSets ruleSets;
    private final NativeApplicationCatalog applications;
    private final NativeCoreEvents coreEvents;
    private final NativeNetworkPlatform networkMonitor;
    private final ConcurrentMap<String, NativeHttpClient.Request> requests = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, NativeNodeProbe> probes = new ConcurrentHashMap<>();
    private final CopyOnWriteArraySet<Consumer<JSObject>> listeners = new CopyOnWriteArraySet<>();
    private volatile Foreground foreground;
    private String lastNetworkIdentity;
    private final Consumer<JSObject> statusEvents = state -> publish("statusChanged", state);
    private NativeClientPrimitives(Context context) {
        this.context=context;store=new NativeStateStore(context);http=new NativeHttpClient(context);
        updater=new NativeApkUpdater(context,http,store);ruleSets=new NativeRuleSets(context,http);
        applications=new NativeApplicationCatalog(context);coreEvents=new NativeCoreEvents(event -> publish("coreEvent",event));
        NativeRuntime.subscribe(statusEvents);
        networkMonitor=new NativeNetworkPlatform(context,null,network -> {
            try { JSObject state=readNetworkContext();String identity=state.getString("identity");
                if (!java.util.Objects.equals(identity,lastNetworkIdentity)) {lastNetworkIdentity=identity;publish("networkChanged",state);}
            } catch (Exception ignored) { /* Offline is not connected. */ }
        });
        networkMonitor.startNetworkMonitor();
    }
    void attach(Foreground value) {foreground=value;}
    void detach(Foreground value) {if(foreground==value)foreground=null;}
    void subscribe(Consumer<JSObject> listener) {listeners.add(listener);}
    void unsubscribe(Consumer<JSObject> listener) {listeners.remove(listener);}
    void cancelPending() {
        requests.values().forEach(NativeHttpClient.Request::cancel);
        probes.values().forEach(NativeNodeProbe::cancel);
        coreEvents.setTopics(java.util.Collections.emptySet());
    }
    private void publish(String name, JSObject value) {
        JSObject envelope=new JSObject();envelope.put("event",name);envelope.put("data",value);
        for(Consumer<JSObject> listener:listeners)try{listener.accept(envelope);}catch(RuntimeException ignored){}
    }
    CompletableFuture<JSObject> invoke(String method, JSObject data) {
        NativeCall call=new NativeCall(data);
        try {
            switch(method) {
                case "listApplications": listApplications(call); break;
                case "prepareSoftwareUpdate": prepareSoftwareUpdate(call); break;
                case "installSoftwareUpdate": installSoftwareUpdate(call); break;
                case "preparedSoftwareUpdate": preparedSoftwareUpdate(call); break;
                case "subscribeCoreEvents": subscribeCoreEvents(call); break;
                case "closeConnections": closeConnections(call); break;
                case "clearLogs": clearLogs(call); break;
                case "measureNode": measureNode(call); break;
                case "cancelProbe": cancelProbe(call); break;
                case "requestText": requestText(call); break;
                case "cancelRequest": cancelRequest(call); break;
                case "networkContext": networkContext(call); break;
                case "capabilities": capabilities(call); break;
                case "status": status(call); break;
                case "appliedReceipt": appliedReceipt(call); break;
                case "clientInfo": clientInfo(call); break;
                case "coreVersion": coreVersion(call); break;
                case "prepareCountryRuleSet": prepareCountryRuleSet(call); break;
                case "coreEnvironment": coreEnvironment(call); break;
                case "checkConfig": checkConfig(call); break;
                case "stop": stop(call); break;
                case "readState": readState(call); break;
                case "writeState": writeState(call); break;
                case "deleteState": deleteState(call); break;
                case "start": start(call); break;
                case "exportDocument": exportDocument(call); break;
                case "importDocument": importDocument(call); break;
                case "openVpnSettings": openVpnSettings(call); break;
                case "openExternal": openExternal(call); break;
                default: call.reject("未知原生操作", "NATIVE_UNKNOWN_METHOD");
            }
        } catch(Exception error) {call.reject("原生操作失败", "NATIVE_OPERATION_FAILED",error);}
        return call.completed;
    }
    private CompletableFuture<JSObject> foreground(String method, JSObject data) {
        Foreground current=foreground;
        if(current==null)return CompletableFuture.failedFuture(new IllegalStateException("此操作需要打开客户端"));
        return current.invoke(method,data);
    }
    private void delegateForeground(NativeCall call,String method) {
        foreground(method,call.getData()).whenComplete((value,error)-> {
            if(error==null)call.resolve(value);else call.reject("无法完成前台操作","FOREGROUND_REQUIRED",error);
        });
    }
    private void exportDocument(NativeCall call) {
        String name=call.getString("name");
        if(name==null || !name.matches("[a-zA-Z0-9_.-]{1,128}\\.(json|md)")){call.reject("无效文件名","DOCUMENT_INVALID");return;}
        try{NativeDocumentIO.encode(call.getString("content"));delegateForeground(call,"exportDocument");}
        catch(Exception error){call.reject("无效文件内容或超过大小限制","DOCUMENT_INVALID",error);}
    }
    private void importDocument(NativeCall call){delegateForeground(call,"importDocument");}
    private void openVpnSettings(NativeCall call){delegateForeground(call,"openVpnSettings");}
    private void openExternal(NativeCall call){
        try{java.net.URI value=new java.net.URI(call.getString("url"));
            if(!"https".equals(value.getScheme())||value.getHost()==null||value.getUserInfo()!=null)throw new IllegalArgumentException();
            delegateForeground(call,"openExternal");
        }catch(Exception error){call.reject("无法打开网站","OPEN_EXTERNAL_FAILED",error);}
    }
    private void start(NativeCall call) {
        try{requireConfig(call);}catch(Exception error){call.reject("无效内核配置","VPN_INVALID_CONFIG",error);return;}
        final boolean wasRunning=NativeRuntime.status().getBoolean("running",false);
        try{NativeRuntime.begin().whenComplete((state,error)->{if(error==null)call.resolve(state);else call.reject("无法启动VPN","VPN_START_FAILED",error);});}
        catch(Exception error){call.reject("已有VPN操作正在执行","VPN_BUSY",error);return;}
        try{
            if(VpnService.prepare(context)==null)startAuthorized(call,wasRunning);
            else foreground("requestVpnPermission",new JSObject()).whenComplete((result,error)->{
                if(error!=null || result==null || !result.getBoolean("authorized",false) || VpnService.prepare(context)!=null)
                    NativeRuntime.complete(wasRunning,"未获得VPN授权");
                else startAuthorized(call,wasRunning);
            });
        }catch(Exception error){NativeRuntime.complete(wasRunning,"无法请求VPN授权");}
    }
    private void startAuthorized(NativeCall call,boolean wasRunning){
        worker.execute(()->{
            try{NativeRuntime.initialize(context);String config=requireConfig(call);Libbox.checkConfig(config);
                NativeVpnLaunchRequest launch=new NativeVpnLaunchRequest(store);
                String token=launch.stage(config,call.getObject("nodes"));
                try{ContextCompat.startForegroundService(context,new Intent(context,ShadowVpnService.class).putExtra(ShadowVpnService.EXTRA_REQUEST,token));}
                catch(Exception error){launch.cancel(token);throw error;}
            }catch(Exception error){NativeRuntime.complete(wasRunning,"无法启动VPN服务");}
        });
    }
    public void listApplications(NativeCall call) {
        worker.execute(() -> {
            try { JSObject result = new JSObject(); result.put("applications", applications.list()); call.resolve(result); }
            catch (Exception error) { call.reject("无法读取应用程序", "APPLICATIONS_READ_FAILED", error); }
        });
    }
    public void prepareSoftwareUpdate(NativeCall call) {
        try { networkWorker.execute(() -> {
            try { call.resolve(updater.prepare(call.getString("url"), call.getString("version"), call.getString("digest"), call.getArray("candidates"))); }
            catch (Exception error) { call.reject("无法下载或验证软件更新", "SOFTWARE_UPDATE_PREPARE_FAILED"); }
        }); } catch (RejectedExecutionException error) { call.reject("更新队列已满或已关闭", "UPDATE_BUSY"); }
    }
    public void installSoftwareUpdate(NativeCall call) {
        worker.execute(() -> {
            try { call.resolve(updater.install()); }
            catch (Exception error) { call.reject("无法打开已验证的更新安装程序", "SOFTWARE_UPDATE_INSTALL_FAILED"); }
        });
    }
    public void preparedSoftwareUpdate(NativeCall call) {
        worker.execute(() -> {
            try { JSObject result = new JSObject(); JSObject update = updater.cached(); result.put("update", update == null ? org.json.JSONObject.NULL : update); call.resolve(result); }
            catch (Exception error) { call.reject("无法读取已验证的软件更新", "SOFTWARE_UPDATE_READ_FAILED"); }
        });
    }
    public void subscribeCoreEvents(NativeCall call) {
        try {
            JSArray requested = call.getArray("topics");
            if (requested == null || requested.length() > 4) throw new IllegalArgumentException("无效订阅类型");
            java.util.Set<String> topics = new java.util.HashSet<>();
            for (int i = 0; i < requested.length(); i++) topics.add(requested.getString(i));
            coreEvents.setTopics(topics); call.resolve();
        } catch (Exception error) { call.reject("内核事件订阅失败", "CORE_SUBSCRIBE_FAILED", error); }
    }
    public void closeConnections(NativeCall call) {
        String id = call.getString("id");
        if (id != null && !id.matches("[a-zA-Z0-9-]{1,128}")) { call.reject("无效连接标识", "CONNECTION_INVALID_ID"); return; }
        worker.execute(() -> {
            try {
                io.nekohasekai.libbox.CommandClient client = Libbox.newStandaloneCommandClient();
                try { if (id == null) client.closeConnections(); else client.closeConnection(id); }
                finally { client.disconnect(); }
                call.resolve();
            } catch (Exception error) { call.reject("无法关闭连接", "CONNECTION_CLOSE_FAILED"); }
        });
    }
    public void clearLogs(NativeCall call) {
        worker.execute(() -> {
            try {
                if (NativeRuntime.status().getBoolean("running", false)) {
                    io.nekohasekai.libbox.CommandClient client = Libbox.newStandaloneCommandClient();
                    try { client.clearLogs(); } finally { client.disconnect(); }
                }
                call.resolve();
            } catch (Exception error) { call.reject("无法清空内核日志", "CORE_LOGS_CLEAR_FAILED"); }
        });
    }
    public void measureNode(NativeCall call) {
        String id = call.getString("id"), tag = call.getString("tag"), target = call.getString("target"), address = call.getString("address");
        Integer port = call.getInt("port");
        String config;
        try {
            config = requireConfig(call);
            if (id == null || !id.matches("[a-zA-Z0-9-]{1,80}") || tag == null || target == null || address == null || port == null || port < 1 || port > 65535) throw new IllegalArgumentException();
        } catch (Exception error) { call.reject("无效节点检测参数", "PROBE_INVALID_REQUEST"); return; }
        NativeNodeProbe probe = new NativeNodeProbe();
        if (probes.putIfAbsent(id, probe) != null) { call.reject("检测标识重复", "PROBE_BUSY"); return; }
        try {
            networkWorker.execute(() -> {
                try { call.resolve(probe.execute(context, config, tag, target, address, port)); }
                catch (CancellationException error) { call.reject("检测已取消", "PROBE_CANCELLED"); }
                catch (Exception error) { call.reject("无法执行节点检测", "PROBE_HOST_FAILED"); }
                finally { probes.remove(id, probe); }
            });
        } catch (RejectedExecutionException error) { probes.remove(id, probe); probe.cancel(); call.reject("检测队列已满或已关闭", "PROBE_BUSY"); }
    }
    public void cancelProbe(NativeCall call) {
        String id = call.getString("id"); NativeNodeProbe probe = id == null ? null : probes.get(id);
        if (probe != null) probe.cancel(); call.resolve();
    }
    public void requestText(NativeCall call) {
        String id = call.getString("id"), url = call.getString("url"), route = call.getString("route", "current");
        String userAgent = call.getString("userAgent", "clash.meta");
        boolean headersOnly = call.getBoolean("headersOnly", false);
        if (id == null || !id.matches("[a-zA-Z0-9-]{1,80}") || userAgent.length() > 256 || userAgent.indexOf('\r') >= 0 || userAgent.indexOf('\n') >= 0) { call.reject("无效请求参数", "HTTP_INVALID_REQUEST"); return; }
        NativeHttpClient.Request request = http.request();
        if (requests.putIfAbsent(id, request) != null) { call.reject("请求标识重复", "HTTP_BUSY"); return; }
        try {
            networkWorker.execute(() -> {
                try { call.resolve(request.execute(url, route, userAgent, headersOnly)); }
                catch (Exception error) {
                    String code = request.timedOut() || error instanceof java.net.SocketTimeoutException ? "HTTP_TIMEOUT"
                        : error instanceof NativeHttpClient.RouteUnavailableException ? "HTTP_ROUTE_UNAVAILABLE"
                        : error instanceof CancellationException ? "HTTP_CANCELLED"
                        : error instanceof javax.net.ssl.SSLException ? "HTTP_TLS_FAILED"
                        : error instanceof IllegalArgumentException ? "HTTP_INVALID_RESPONSE"
                        : "HTTP_REQUEST_FAILED";
                    call.reject("网络请求失败", code);
                }
                finally { requests.remove(id, request); }
            });
        } catch (RejectedExecutionException error) { requests.remove(id, request); call.reject("网络请求队列已满或已关闭", "HTTP_BUSY"); }
    }
    public void cancelRequest(NativeCall call) {
        String id = call.getString("id"); NativeHttpClient.Request request = id == null ? null : requests.get(id);
        if (request != null) request.cancel(); call.resolve();
    }
    private JSObject readNetworkContext() {
        android.net.ConnectivityManager connectivity = (android.net.ConnectivityManager) context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        android.net.Network active = connectivity.getActiveNetwork();
        android.net.Network physical = NativeNetworkPlatform.findPhysicalNetwork(connectivity);
        android.net.LinkProperties actual = active == null ? null : connectivity.getLinkProperties(active);
        android.net.LinkProperties underlying = physical == null ? null : connectivity.getLinkProperties(physical);
        android.net.ProxyInfo proxy = actual == null ? null : actual.getHttpProxy();
        JSObject result = new JSObject();
        result.put("identity", (active == null ? "offline" : Long.toString(active.getNetworkHandle())) + ":" +
            (physical == null ? "offline" : Long.toString(physical.getNetworkHandle())) + ":" +
            (proxy == null ? "" : proxy.toString()) + ":" +
            (underlying == null ? "" : underlying.getLinkAddresses().toString() + underlying.getDnsServers().toString()));
        return result;
    }
    public void networkContext(NativeCall call) {
        worker.execute(() -> {
            try { call.resolve(readNetworkContext()); }
            catch (Exception error) { call.reject("无法读取当前网络路径", "NETWORK_CONTEXT_FAILED"); }
        });
    }
    public void capabilities(NativeCall call) {
        JSObject result = new JSObject(); result.put("platform", "android"); result.put("vpn", true);
        result.put("connectionOwner", Build.VERSION.SDK_INT >= 29); result.put("systemProxy", false);
        result.put("desktopLoginAutostart", false); result.put("externalCoreReplacement", false);
        call.resolve(result);
    }
    public void status(NativeCall call) { call.resolve(NativeRuntime.status()); }
    public void appliedReceipt(NativeCall call) {
        try { call.resolve(NativeRuntime.appliedReceipt()); }
        catch (Exception error) { call.reject("无法读取已应用配置", "VPN_RECEIPT_FAILED"); }
    }
    public void clientInfo(NativeCall call) {
        worker.execute(() -> {
            try {
                NativeRuntime.initialize(context);
                android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                JSObject result = new JSObject(); result.put("appVersion", info.versionName); result.put("appName", "暗影VPN");
                result.put("singBoxVersion", Libbox.version()); result.put("platform", "android");
                result.put("arch", Build.SUPPORTED_ABIS[0]); result.put("osVersion", Build.VERSION.RELEASE);
                result.put("buildDate", ""); result.put("copyright", "Based on 暗影VPN © dododook; MIT License");
                result.put("repositoryUrl", "https://github.com/dsanying/VPN"); call.resolve(result);
            } catch (Exception error) { call.reject("无法读取版本信息", "VERSION_READ_FAILED"); }
        });
    }
    public void coreVersion(NativeCall call) {
        worker.execute(() -> { try { NativeRuntime.initialize(context); JSObject result = new JSObject(); result.put("version", Libbox.version()); call.resolve(result); } catch (Exception e) { call.reject("无法加载内核", e); } });
    }
    public void prepareCountryRuleSet(NativeCall call) {
        try { networkWorker.execute(() -> {
            try { call.resolve(ruleSets.prepare(call.getString("country"), call.getBoolean("force", false))); }
            catch (Exception error) { call.reject("无法准备当前地区分流资源", "ROUTING_DATA_FAILED"); }
        }); } catch (RejectedExecutionException error) { call.reject("网络任务已满或已关闭", "ROUTING_DATA_BUSY"); }
    }
    public void coreEnvironment(NativeCall call) {
        worker.execute(() -> {
            try {
                NativeRuntime.initialize(context);
                JSObject result = new JSObject();
                result.put("stateDirectory", new java.io.File(context.getFilesDir(), "core").getAbsolutePath());
                result.put("version", Libbox.version());
                call.resolve(result);
            } catch (Exception error) { call.reject("无法准备内核目录", "CORE_SETUP_FAILED", error); }
        });
    }
    public void checkConfig(NativeCall call) {
        worker.execute(() -> { try { NativeRuntime.initialize(context); Libbox.checkConfig(requireConfig(call)); call.resolve(); } catch (Exception e) { call.reject("内核配置无效", e); } });
    }
    private String requireConfig(NativeCall call) {
        String config = call.getString("config");
        if (config == null || config.trim().isEmpty() || config.length() > 16 * 1024 * 1024) throw new IllegalArgumentException("缺少有效内核配置");
        return config;
    }
    public void stop(NativeCall call) {
        worker.execute(() -> {
            if (NativeRuntime.status().getBoolean("busy", false)) { call.reject("已有 VPN 操作正在执行", "VPN_BUSY"); return; }
            if (!NativeRuntime.status().getBoolean("running", false)) {
                try { new NativeVpnJournal(store).clear(); call.resolve(NativeRuntime.status()); }
                catch (Exception error) { call.reject("无法清理 VPN 恢复记录", "VPN_STOP_FAILED"); }
                return;
            }
            boolean begun = false;
            try {
                CompletableFuture<JSObject> completed = NativeRuntime.begin(); begun = true;
                context.startService(new Intent(context, ShadowVpnService.class).setAction(ShadowVpnService.ACTION_STOP));
                completed.whenComplete((state, error) -> { if (error == null) call.resolve(state); else call.reject(error.getMessage(), "VPN_STOP_FAILED"); });
            } catch (Exception e) {
                if (begun) NativeRuntime.complete(true, e.getMessage());
                else call.reject(e.getMessage(), e);
            }
        });
    }
    public void readState(NativeCall call) {
        worker.execute(() -> { try { NativeStateStore.publicDocument(call.getString("name")); String value = store.read(call.getString("name")); JSObject result = new JSObject(); result.put("content", value == null ? org.json.JSONObject.NULL : value); String revision = NativeStateStore.revision(value); result.put("revision", revision == null ? org.json.JSONObject.NULL : revision); call.resolve(result); } catch (Exception e) { call.reject(e.getMessage(), e); } });
    }
    public void writeState(NativeCall call) {
        worker.execute(() -> {
            try {
                String name = call.getString("name"), content = call.getString("content");
                NativeStateStore.publicDocument(name);
                JSObject result = new JSObject();
                if ("config".equals(name)) {
                    if (!call.getData().has("expectedRevision")) throw new IllegalArgumentException("配置保存需要读取版本");
                    result.put("revision", store.compareAndWrite(name, content, call.getString("expectedRevision")));
                } else store.write(name, content);
                call.resolve(result);
            } catch (NativeStateStore.Conflict error) { call.reject(error.getMessage(), "CONFIG_WRITE_CONFLICT"); }
            catch (Exception error) { call.reject("状态保存失败", "STATE_WRITE_FAILED"); }
        });
    }
    public void deleteState(NativeCall call) {
        worker.execute(() -> { try { String name = call.getString("name"); NativeStateStore.publicDocument(name); if ("config".equals(name)) throw new IllegalArgumentException("配置只能通过校验保存修改"); store.delete(name); call.resolve(); } catch (Exception e) { call.reject(e.getMessage(), e); } });
    }
    @Override public void close(){
        NativeRuntime.unsubscribe(statusEvents);networkMonitor.close();coreEvents.close();updater.close();ruleSets.close();
        requests.values().forEach(NativeHttpClient.Request::cancel);probes.values().forEach(NativeNodeProbe::cancel);
        networkWorker.shutdown();http.close();worker.execute(()->{updater.awaitIdle();store.close();});worker.shutdown();listeners.clear();foreground=null;
    }
}
