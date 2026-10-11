package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.javascriptengine.*;
import com.getcapacitor.JSObject;
import com.google.common.util.concurrent.ListenableFuture;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import org.json.*;

/** One application-owned JS business runtime. Data enters by named byte buffers, never source concatenation. */
final class NativeBusinessHost implements AutoCloseable {
    private static CompletableFuture<NativeBusinessHost> singleton;
    static synchronized CompletableFuture<NativeBusinessHost> get(Context context) {
        if(singleton!=null && singleton.isDone() && !singleton.isCompletedExceptionally() && singleton.getNow(null).closed) singleton=null;
        if(singleton==null) {
            NativeBusinessHost host=new NativeBusinessHost(context.getApplicationContext());
            CompletableFuture<NativeBusinessHost> created=host.ready.thenApply(value->host);
            singleton=created;
            created.whenComplete((value,error)->{if(error!=null)synchronized(NativeBusinessHost.class){if(singleton==created)singleton=null;}});
            return created;
        }
        return singleton;
    }
    private final Context context;
    private final NativeClientPrimitives primitives;
    private final ExecutorService bootWorker=Executors.newSingleThreadExecutor();
    private final ExecutorService messages=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(512),new ThreadPoolExecutor.AbortPolicy());
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor();
    private static final class TimerRegistration {
        final java.util.concurrent.atomic.AtomicBoolean pending=new java.util.concurrent.atomic.AtomicBoolean();
        volatile ScheduledFuture<?> future;
        void cancel(){ScheduledFuture<?> current=future;if(current!=null)current.cancel(false);}
    }
    private final ConcurrentMap<Long,TimerRegistration> timers=new ConcurrentHashMap<>();
    private final CopyOnWriteArraySet<Consumer<JSObject>> listeners=new CopyOnWriteArraySet<>();
    private final ConcurrentMap<String,java.util.Set<CompletableFuture<?>>> views=new ConcurrentHashMap<>();
    private final AtomicLong identities=new AtomicLong();
    private final CompletableFuture<JSObject> ready=new CompletableFuture<>();
    private final Consumer<JSObject> events=envelope->{
        JSObject message=new JSObject();message.put("kind","event");message.put("event",envelope.getString("event"));message.put("data",envelope.getJSObject("data"));deliver(message);
    };
    private volatile boolean closed;
    private JavaScriptSandbox sandbox;
    private JavaScriptIsolate isolate;
    private NativeBusinessHost(Context context) {
        this.context=context;primitives=NativeClientPrimitives.get(context);
        bootWorker.execute(()->{
            try {
                if(!JavaScriptSandbox.isSupported())throw new IllegalStateException("当前系统 WebView 不支持后台业务引擎");
                sandbox=JavaScriptSandbox.createConnectedInstanceAsync(context).get(30,TimeUnit.SECONDS);
                for(String capability:new String[]{JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN,JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,JavaScriptSandbox.JS_FEATURE_CONSOLE_MESSAGING,JavaScriptSandbox.JS_FEATURE_ISOLATE_TERMINATION,JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT})
                    if(!sandbox.isFeatureSupported(capability))throw new IllegalStateException("当前系统 WebView 缺少后台能力");
                IsolateStartupParameters parameters=new IsolateStartupParameters();parameters.setMaxEvaluationReturnSizeBytes(32*1024*1024);
                isolate=sandbox.createIsolate(parameters);
                isolate.addOnTerminatedCallback(Runnable::run,info->terminate());
                isolate.setConsoleCallback(messages,new JavaScriptConsoleCallback(){
                    @Override public void onConsoleMessage(ConsoleMessage message){
                        // No source, trace, configuration or arbitrary console text is logged.
                        if(!closed && "shadow-native-wake".equals(message.getMessage()))drain();
                    }
                });
                try(java.io.InputStream input=context.getAssets().open("headless/service.js")){
                    isolate.evaluateJavaScriptAsync(NativeDocumentIO.read(input)).get(30,TimeUnit.SECONDS);
                }
                byte[] entropy=new byte[65536];new java.security.SecureRandom().nextBytes(entropy);
                isolate.provideNamedData("initial-entropy",entropy);
                String result=isolate.evaluateJavaScriptAsync("ShadowHost.boot('initial-entropy')").get(90,TimeUnit.SECONDS);
                java.util.Arrays.fill(entropy,(byte)0);
                ready.complete(new JSObject(result));
            }catch(Exception error){ready.completeExceptionally(new IllegalStateException("后台业务引擎初始化失败",error));close();}
            finally{bootWorker.shutdown();}
        });
    }
    private static <T> CompletableFuture<T> future(ListenableFuture<T> source){
        CompletableFuture<T> result=new CompletableFuture<>();
        source.addListener(()->{try{result.complete(source.get());}catch(Exception error){result.completeExceptionally(error);}},Runnable::run);
        return result;
    }
    synchronized boolean subscribe(Consumer<JSObject> listener){if(closed)return false;listeners.add(listener);return true;}
    synchronized void unsubscribe(Consumer<JSObject> listener){listeners.remove(listener);}
    synchronized void releaseBackground(){if(listeners.isEmpty())close();}
    CompletableFuture<JSObject> bootstrap(){return ready;}
    CompletableFuture<String> activate(){return evaluate("ShadowHost.activate()");}
    CompletableFuture<String> maintain(){return evaluate("ShadowHost.maintain()");}
    private CompletableFuture<String> evaluate(String expression){
        return ready.thenCompose(ignored->{if(closed)return CompletableFuture.failedFuture(new IllegalStateException("后台业务引擎已关闭"));return future(isolate.evaluateJavaScriptAsync(expression));});
    }
    CompletableFuture<JSObject> invoke(JSObject data){
        return invoke(data,"native-test");
    }
    synchronized CompletableFuture<JSObject> invoke(JSObject data,String viewOwner){
        java.util.Set<CompletableFuture<?>> requests=views.get(viewOwner);
        if(!"native-test".equals(viewOwner)&&requests==null)return CompletableFuture.failedFuture(new IllegalStateException("界面身份已撤销"));
        CompletableFuture<JSObject> request=ready.thenCompose(ignored->{
            if(closed)return CompletableFuture.failedFuture(new IllegalStateException("后台业务引擎已关闭"));
            try {
                JSObject command=new JSObject(data.toString());command.put("viewOwner",viewOwner);
                String name=provide(command);
                return future(isolate.evaluateJavaScriptAsync("ShadowHost.invokeClient('"+name+"')")).thenApply(value->{try{return new JSObject(value);}catch(JSONException error){throw new CompletionException(error);}});
            }catch(Exception error){return CompletableFuture.failedFuture(error);}
        });
        return trackView(request,requests);
    }
    synchronized CompletableFuture<String> releaseView(String owner){
        java.util.Set<CompletableFuture<?>> requests=views.remove(owner);
        CompletableFuture<?>[] pending=requests==null?new CompletableFuture[0]:requests.toArray(new CompletableFuture[0]);
        // Revoke immediately, then drain already accepted commands before releasing their subscriptions.
        return CompletableFuture.allOf(pending).handle((value,error)->null).thenCompose(ignored->ready).thenCompose(ignored->{
            if(closed)return CompletableFuture.completedFuture("closed");
            try{String name=provide(new JSObject().put("owner",owner));return future(isolate.evaluateJavaScriptAsync("ShadowHost.releaseView('"+name+"')"));}
            catch(Exception error){return CompletableFuture.failedFuture(error);}
        });
    }
    synchronized CompletableFuture<String> attachView(String owner){
        if(views.containsKey(owner))return CompletableFuture.failedFuture(new IllegalStateException("界面身份重复"));
        java.util.Set<CompletableFuture<?>> requests=ConcurrentHashMap.newKeySet();views.put(owner,requests);
        CompletableFuture<String> request=ready.thenCompose(ignored->{
            if(closed)return CompletableFuture.failedFuture(new IllegalStateException("后台业务引擎已关闭"));
            try{String name=provide(new JSObject().put("owner",owner));return future(isolate.evaluateJavaScriptAsync("ShadowHost.attachView('"+name+"')"));}
            catch(Exception error){return CompletableFuture.failedFuture(error);}
        });
        request.whenComplete((value,error)->{if(error!=null)views.remove(owner,requests);});
        return trackView(request,requests);
    }
    private static <T> CompletableFuture<T> trackView(CompletableFuture<T> request,java.util.Set<CompletableFuture<?>> requests){
        if(requests!=null){requests.add(request);request.whenComplete((value,error)->requests.remove(request));}
        return request;
    }
    private synchronized void terminate(){
        if(closed)return;
        java.util.List<Consumer<JSObject>> attached=new java.util.ArrayList<>(listeners);
        close();
        JSObject notification=new JSObject().put("channel","client:hostClosed").put("data",new JSObject());
        for(Consumer<JSObject> listener:attached)try{listener.accept(notification);}catch(RuntimeException ignored){/* Each view recovers independently. */}
    }
    private String provide(JSONObject data){
        long id=identities.incrementAndGet();if(id<=0)throw new IllegalStateException("消息标识已耗尽");
        byte[] bytes=data.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>20*1024*1024)throw new IllegalArgumentException("后台消息超过大小限制");
        String name="native-message-"+id;
        isolate.provideNamedData(name,bytes);
        return name; // Do not erase before asynchronous named-data transfer finishes.
    }
    private void deliver(JSONObject data){
        if(closed)return;
        try {
            messages.execute(()->{
                if(closed)return;
                try{String name=provide(data);future(isolate.evaluateJavaScriptAsync("ShadowHost.deliver('"+name+"')")).exceptionally(error->{terminate();return null;});}
                catch(Exception error){terminate();}
            });
        }catch(RejectedExecutionException error){if(!closed)terminate();}
    }
    private void drain(){
        if(closed)return;
        try {
            JSONArray batch=new JSONArray(isolate.evaluateJavaScriptAsync("ShadowHost.drain()").get(30,TimeUnit.SECONDS));
            if(batch.length()>256)throw new IllegalArgumentException("后台任务队列超过限制");
            for(int index=0;index<batch.length();index++){
                JSONObject message=batch.getJSONObject(index);String kind=message.getString("kind");
                switch(kind){
                    case "bridgeReady":primitives.subscribe(events);break;
                    case "call": {
                        long id=message.getLong("id");if(id<=0)throw new IllegalArgumentException("无效调用标识");
                        String method=message.getString("method");
                        CompletableFuture<JSObject> operation;
                        if("entropy".equals(method)){
                            byte[] bytes=new byte[65536];new java.security.SecureRandom().nextBytes(bytes);
                            JSObject value=new JSObject();value.put("base64",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP));java.util.Arrays.fill(bytes,(byte)0);
                            operation=CompletableFuture.completedFuture(value);
                        }else operation=primitives.invoke(method,message.has("data")&&!message.isNull("data")?JSObject.fromJSONObject(message.getJSONObject("data")):new JSObject());
                        operation.whenComplete((value,error)->{
                            JSObject reply=new JSObject();reply.put("kind","reply");reply.put("id",id);
                            if(error==null)reply.put("value",value==null?JSONObject.NULL:value);
                            else{JSObject failure=new JSObject();String code=error instanceof NativeCall.Failure?((NativeCall.Failure)error).code:"NATIVE_OPERATION_FAILED";failure.put("code",code);failure.put("message","原生操作失败："+code);reply.put("error",failure);}
                            deliver(reply);
                        });break;
                    }
                    case "timer": {
                        long id=message.getLong("id"),delay=message.getLong("delay");boolean repeat=message.getBoolean("repeat");
                        if(id<=0||delay<0||delay>2147483647L||timers.size()>=256||timers.containsKey(id))throw new IllegalArgumentException("无效后台计时器");
                        TimerRegistration registration=new TimerRegistration();
                        timers.put(id,registration);
                        Runnable action=()->{
                            if(closed||timers.get(id)!=registration||!registration.pending.compareAndSet(false,true))return;
                            try{messages.execute(()->{
                                if(closed||timers.get(id)!=registration){registration.pending.set(false);return;}
                                if(!repeat)timers.remove(id,registration);
                                try{future(isolate.evaluateJavaScriptAsync("ShadowHost.fireTimer("+id+")")).whenComplete((value,error)->{registration.pending.set(false);if(error!=null)terminate();});}
                                catch(RuntimeException error){registration.pending.set(false);terminate();}
                            });}catch(RejectedExecutionException error){registration.pending.set(false);if(!closed)terminate();}
                        };
                        registration.future=repeat?clock.scheduleWithFixedDelay(action,Math.max(1,delay),Math.max(1,delay),TimeUnit.MILLISECONDS):clock.schedule(action,delay,TimeUnit.MILLISECONDS);
                        break;
                    }
                    case "cancelTimer":{TimerRegistration timer=timers.remove(message.getLong("id"));if(timer!=null)timer.cancel();break;}
                    case "clientEvent":{
                        JSObject value=new JSObject();value.put("channel",message.getString("channel"));value.put("data",message.opt("data"));
                        for(Consumer<JSObject> listener:listeners)try{listener.accept(value);}catch(RuntimeException ignored){}break;
                    }
                    default:throw new IllegalArgumentException("未知后台消息类型");
                }
            }
        }catch(Exception error){terminate();}
    }
    @Override public synchronized void close(){
        if(closed)return;closed=true;primitives.unsubscribe(events);primitives.cancelPending();listeners.clear();views.clear();
        timers.values().forEach(TimerRegistration::cancel);timers.clear();clock.shutdown();
        if(isolate!=null)isolate.close();if(sandbox!=null)sandbox.close();messages.shutdown();
        if(!ready.isDone())ready.completeExceptionally(new IllegalStateException("后台业务引擎已关闭"));
    }
}
