package com.dsanying.shadowvpn.app;

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.concurrent.*;
import java.util.function.Consumer;

@CapacitorPlugin(name="ShadowVpn")
public final class ShadowVpnPlugin extends Plugin implements NativeClientPrimitives.Foreground {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final ConcurrentMap<String,CompletableFuture<JSObject>> pending=new ConcurrentHashMap<>();
    private NativeClientPrimitives owner;
    private volatile NativeBusinessHost business;
    private volatile boolean destroyed;
    private String viewOwner=java.util.UUID.randomUUID().toString();
    private boolean foregroundActivated;
    private final Consumer<JSObject> businessEvents=value->notifyListeners("clientEvent",value);
        @Override public void load(){owner=NativeClientPrimitives.get(getContext());owner.attach(this);}
    @Override protected synchronized void handleOnDestroy(){destroyed=true;owner.detach(this);if(business!=null){business.unsubscribe(businessEvents);business.releaseView(viewOwner);}pending.values().forEach(future->future.completeExceptionally(new IllegalStateException("授权界面已关闭")));pending.clear();worker.shutdown();super.handleOnDestroy();}
    @PluginMethod public synchronized void clientBootstrap(PluginCall call){
        if(destroyed){call.reject("授权界面已关闭","BUSINESS_VIEW_CLOSED");return;}
        if(business!=null){business.unsubscribe(businessEvents);business.releaseView(viewOwner);business=null;}
        viewOwner=java.util.UUID.randomUUID().toString();
        bootstrap(call,viewOwner,0);
    }
    private void bootstrap(PluginCall call,String lease,int attempt){
        NativeBusinessHost.get(getContext()).whenComplete((host,error)->{
            if(error!=null){call.reject("后台业务引擎不可用","BUSINESS_HOST_FAILED");return;}
            boolean activate;
            synchronized(this){
                if(destroyed||!viewOwner.equals(lease)){call.reject("授权界面已关闭","BUSINESS_VIEW_CLOSED");return;}
                if(!host.subscribe(businessEvents)){if(attempt==0){bootstrap(call,lease,1);}else call.reject("后台业务引擎已关闭","BUSINESS_HOST_CLOSED");return;}
                business=host;activate=!foregroundActivated;foregroundActivated=true;
            }
            host.attachView(lease).thenCompose(ignored->activate?host.activate():CompletableFuture.completedFuture("active"))
                .thenCompose(ignored->host.bootstrap()).whenComplete((value,failure)->{
                    synchronized(this){
                        if(destroyed||!viewOwner.equals(lease)){host.releaseView(lease);call.reject("授权界面已关闭","BUSINESS_VIEW_CLOSED");return;}
                        if(failure==null)call.resolve(value);else call.reject("客户端初始化失败","BUSINESS_BOOTSTRAP_FAILED");
                    }
                });
        });
    }
    @PluginMethod public synchronized void clientInvoke(PluginCall call){
        NativeBusinessHost host=business;
        if(host==null||destroyed){call.reject("客户端尚未初始化","BUSINESS_NOT_READY");return;}
        host.invoke(call.getData(),viewOwner).whenComplete((value,error)->{
            if(error==null)call.resolve(value);else call.reject("客户端操作失败","BUSINESS_INVOKE_FAILED");
        });
    }
    @PluginMethod public synchronized void clientDisconnect(PluginCall call){
        NativeBusinessHost host=business;
        if(host==null){call.resolve();return;}
        business=null;String released=viewOwner;viewOwner=java.util.UUID.randomUUID().toString();host.unsubscribe(businessEvents);
        host.releaseView(released).whenComplete((value,error)->{
            if(error==null)call.resolve();else call.reject("界面订阅释放失败","BUSINESS_DISCONNECT_FAILED");
        });
    }
    @Override public CompletableFuture<JSObject> invoke(String method,JSObject data){
        CompletableFuture<JSObject> result=new CompletableFuture<>();
        Activity activity=getActivity();
        if(destroyed||activity==null||activity.isFinishing()||activity.isDestroyed())return CompletableFuture.failedFuture(new IllegalStateException("授权界面已关闭"));
        String id=java.util.UUID.randomUUID().toString();pending.put(id,result);
        PluginCall call=new PluginCall(null,"ShadowVpn",id,method,data){
            @Override public void resolve(){result.complete(new JSObject());}
            @Override public void resolve(JSObject value){result.complete(value);}
            @Override public void reject(String message,String code,Exception error,JSObject details){result.completeExceptionally(new IllegalStateException(message));}
        };
        result.whenComplete((value,error)->{pending.remove(id);if(getBridge()!=null)getBridge().releaseCall(call);});
        try { activity.runOnUiThread(()->{
            if(!pending.containsKey(id))return;
            try {
            if(destroyed||activity.isFinishing()||activity.isDestroyed())throw new IllegalStateException("授权界面已关闭");
            switch(method){
                case "exportDocument":foregroundExportDocument(call);break;
                case "importDocument":foregroundImportDocument(call);break;
                case "openVpnSettings":foregroundOpenVpnSettings(call);break;
                case "openExternal":foregroundOpenExternal(call);break;
                case "requestVpnPermission":requestVpnPermission(call);break;
                default:result.completeExceptionally(new IllegalArgumentException("未知前台操作"));
            }
            }catch(Exception error){result.completeExceptionally(error);}
        }); }catch(Exception error){result.completeExceptionally(error);}return result;
    }
    private void requestVpnPermission(PluginCall call){
        Intent intent=VpnService.prepare(getContext());
        if(intent==null){call.resolve(new JSObject().put("authorized",true));return;}
        startActivityForResult(call,intent,"vpnPermissionResult");
    }
    @ActivityCallback private void vpnPermissionResult(PluginCall call,ActivityResult result){
        if(call!=null)call.resolve(new JSObject().put("authorized",result.getResultCode()==Activity.RESULT_OK && VpnService.prepare(getContext())==null));
    }
    private void foregroundExportDocument(PluginCall call) {
        String name = call.getString("name");
        if (name == null || !name.matches("[a-zA-Z0-9_.-]{1,128}\\.(json|md)")) { call.reject("无效文件名", "DOCUMENT_INVALID"); return; }
        try { NativeDocumentIO.encode(call.getString("content")); }
        catch (Exception error) { call.reject("无效文件内容或超过大小限制", "DOCUMENT_INVALID"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(name.endsWith(".md") ? "text/markdown" : "application/json").putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "documentExportResult");
    }
    @ActivityCallback private void documentExportResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (destroyed) { call.reject("授权界面已关闭", "BUSINESS_VIEW_CLOSED"); return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject canceled = new JSObject(); canceled.put("canceled", true); call.resolve(canceled); return;
        }
        android.net.Uri uri = result.getData().getData();
        if (!"content".equals(uri.getScheme())) { call.reject("无效文件来源", "DOCUMENT_INVALID"); return; }
        submitDocument(call, () -> {
            try (java.io.OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new java.io.IOException("无法写入文件");
                output.write(NativeDocumentIO.encode(call.getString("content"))); output.flush();
                JSObject response = new JSObject(); response.put("canceled", false); call.resolve(response);
            } catch (Exception error) { call.reject("文件保存失败", "DOCUMENT_WRITE_FAILED"); }
        });
    }
    private void foregroundImportDocument(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        startActivityForResult(call, intent, "documentImportResult");
    }
    @ActivityCallback private void documentImportResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (destroyed) { call.reject("授权界面已关闭", "BUSINESS_VIEW_CLOSED"); return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject canceled = new JSObject(); canceled.put("canceled", true); call.resolve(canceled); return;
        }
        android.net.Uri uri = result.getData().getData();
        if (!"content".equals(uri.getScheme())) { call.reject("无效文件来源", "DOCUMENT_INVALID"); return; }
        submitDocument(call, () -> {
            try (java.io.InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                JSObject response = new JSObject(); response.put("canceled", false); response.put("content", NativeDocumentIO.read(input)); call.resolve(response);
            } catch (Exception error) { call.reject("文件读取失败或超过大小限制", "DOCUMENT_READ_FAILED"); }
        });
    }
    private void submitDocument(PluginCall call, Runnable task) {
        try {
            worker.execute(() -> {
                if (destroyed) { call.reject("授权界面已关闭", "BUSINESS_VIEW_CLOSED"); return; }
                task.run();
            });
        } catch (RejectedExecutionException error) {
            call.reject("授权界面已关闭", "BUSINESS_VIEW_CLOSED");
        }
    }
    private void foregroundOpenVpnSettings(PluginCall call) {
        try { getActivity().startActivity(new Intent(android.provider.Settings.ACTION_VPN_SETTINGS)); call.resolve(); }
        catch (Exception error) { call.reject("无法打开系统 VPN 设置", "VPN_SETTINGS_FAILED"); }
    }
    private void foregroundOpenExternal(PluginCall call) {
        try {
            java.net.URI value = new java.net.URI(call.getString("url"));
            if (!"https".equals(value.getScheme()) || value.getHost() == null || value.getUserInfo() != null) throw new IllegalArgumentException();
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(value.toString()))); call.resolve();
        } catch (Exception error) { call.reject("无法打开网站", "OPEN_EXTERNAL_FAILED"); }
    }
}
