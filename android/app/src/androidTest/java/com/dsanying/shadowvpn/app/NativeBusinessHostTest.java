package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class NativeBusinessHostTest {
    @Test public void backgroundReleaseCannotCloseAnAttachedViewAndClosedHostRejectsAttachment() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeBusinessHost host=NativeBusinessHost.get(context).get(90,TimeUnit.SECONDS);
        java.util.function.Consumer<JSObject> listener=event->{};
        assertTrue(host.subscribe(listener));
        host.releaseBackground();
        assertSame(host,NativeBusinessHost.get(context).get(5,TimeUnit.SECONDS));
        host.unsubscribe(listener);host.releaseBackground();
        assertFalse(host.subscribe(listener));
        assertNotSame(host,NativeBusinessHost.get(context).get(90,TimeUnit.SECONDS));
    }
    @Test public void revokedViewRejectsLateSubscriptionsAndRenewedViewHasIndependentOwnership() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeBusinessHost host=NativeBusinessHost.get(context).get(90,TimeUnit.SECONDS);
        String owner="fictional-view-"+java.util.UUID.randomUUID();
        host.attachView(owner).get(10,TimeUnit.SECONDS);
        java.util.concurrent.CompletableFuture<JSObject> accepted=host.invoke(new JSObject().put("channel","stats:subscribe").put("args",new JSObject().put("topic","stats")),owner);
        java.util.concurrent.CompletableFuture<String> released=host.releaseView(owner);
        assertTrue(accepted.get(30,TimeUnit.SECONDS).getBoolean("success",false));
        released.get(30,TimeUnit.SECONDS);
        try {
            host.invoke(new JSObject().put("channel","stats:subscribe").put("args",new JSObject().put("topic","stats")),owner).get(10,TimeUnit.SECONDS);
            fail("Revoked view must not restart collection");
        } catch(java.util.concurrent.ExecutionException expected) {
            assertTrue(expected.getCause().getMessage().contains("撤销"));
        }
        String renewed=owner+"-renewed";
        host.attachView(renewed).get(10,TimeUnit.SECONDS);
        assertTrue(host.invoke(new JSObject().put("channel","config:get"),renewed).get(30,TimeUnit.SECONDS).getBoolean("success",false));
        host.releaseView(renewed).get(10,TimeUnit.SECONDS);
    }
    @Test public void primitiveArraysPreserveStructuredPayloads() throws Exception {
        NativeCall call=new NativeCall(new JSObject("{\"topics\":[\"logs\"],\"candidates\":[{\"url\":\"https://example.com/update.apk\"}]}"));
        assertEquals("logs",call.getArray("topics").getString(0));
        assertEquals("https://example.com/update.apk",call.getArray("candidates").getJSONObject(0).getString("url"));
        assertNull(call.getArray("missing"));
    }
    @Test public void oneBusinessOwnerDispatchesActualSharedServiceWithoutActivity() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeBusinessHost first=NativeBusinessHost.get(context).get(90,TimeUnit.SECONDS);
        assertSame(first,NativeBusinessHost.get(context).get(5,TimeUnit.SECONDS));
        assertEquals("android",first.bootstrap().get(5,TimeUnit.SECONDS).getJSObject("capabilities").getString("platform"));
        JSObject version=first.invoke(new JSObject().put("channel","version:getInfo")).get(30,TimeUnit.SECONDS);
        assertTrue(version.getBoolean("success",false));
        assertEquals("android",version.getJSObject("data").getString("platform"));
        JSObject config=first.invoke(new JSObject().put("channel","config:get")).get(30,TimeUnit.SECONDS);
        assertTrue(config.getBoolean("success",false));
        JSObject unknown=first.invoke(new JSObject().put("channel","fictional:unknown")).get(30,TimeUnit.SECONDS);
        assertFalse("Unknown operations cannot fabricate success",unknown.getBoolean("success",false));
    }
    @Test public void nativePrimitivesSurviveForegroundDetachmentAndRejectForegroundOnlyActions() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeClientPrimitives owner=NativeClientPrimitives.get(context);
        NativeClientPrimitives.Foreground foreground=(method,data)->java.util.concurrent.CompletableFuture.completedFuture(new JSObject());
        owner.attach(foreground);owner.detach(foreground);
        assertSame(owner,NativeClientPrimitives.get(context));
        assertFalse(owner.invoke("status",new JSObject()).get(5,TimeUnit.SECONDS).getBoolean("busy",true));
        try{owner.invoke("importDocument",new JSObject()).get(5,TimeUnit.SECONDS);fail("A missing Activity must not produce a successful document import");}
        catch(java.util.concurrent.ExecutionException expected){assertTrue(expected.getCause() instanceof NativeCall.Failure);}
    }
}
