package com.dsanying.shadowvpn.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.concurrent.CompletableFuture;

/** A primitive invocation is independent of a WebView callback and Activity lifecycle. */
final class NativeCall {
    static final class Failure extends RuntimeException {
        final String code;
        Failure(String message,String code,Throwable cause){super(message,cause);this.code=code;}
    }
    final CompletableFuture<JSObject> completed=new CompletableFuture<>();
    private final JSObject data;
    NativeCall(JSObject data){this.data=data==null ? new JSObject() : data;}
    JSObject getData(){return data;}
    String getString(String name){return data.getString(name);}
    String getString(String name,String fallback){return data.getString(name,fallback);}
    Integer getInt(String name){return data.getInteger(name);}
    Boolean getBoolean(String name,boolean fallback){return data.getBoolean(name,fallback);}
    JSObject getObject(String name){return data.getJSObject(name);}
    JSArray getArray(String name){
        try{return new JSArray(data.getJSONArray(name).toString());}catch(org.json.JSONException error){return null;}
    }
    void resolve(){resolve(new JSObject());}
    void resolve(JSObject value){completed.complete(value);}
    void reject(String message,String code){reject(message,code,null);}
    void reject(String message,Throwable error){reject(message,"NATIVE_OPERATION_FAILED",error);}
    void reject(String message,String code,Throwable error){completed.completeExceptionally(new Failure(message,code,error));}
}
