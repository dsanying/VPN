package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.javascriptengine.JavaScriptSandbox;
import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.Message;
import androidx.javascriptengine.MessagePort;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Capability proof before moving the shared business dispatcher to an Activity-independent host. */
@RunWith(AndroidJUnit4.class)
public class NativeBackgroundEngineTest {
    @Test public void sharedHostFoundationWorksInsideTheActualHeadlessEngine() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String foundation;
        try (java.io.InputStream input = InstrumentationRegistry.getInstrumentation().getContext()
                .getAssets().open("headless/environment.js")) {
            foundation = NativeDocumentIO.read(input);
        }
        assertFalse("Generated shared foundation must exist", foundation.isEmpty());
        try (JavaScriptSandbox sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context).get(30, TimeUnit.SECONDS);
             JavaScriptIsolate isolate = sandbox.createIsolate()) {
            isolate.evaluateJavaScriptAsync(foundation).get(30, TimeUnit.SECONDS);
            byte[] entropy = new byte[65536];
            new java.security.SecureRandom().nextBytes(entropy);
            isolate.provideNamedData("entropy", entropy);
            String report = isolate.evaluateJavaScriptAsync(
                "android.consumeNamedDataAsArrayBuffer('entropy').then(async buffer => {" +
                "const timers=[];const canceled=[];let calls=0;" +
                "const host=ShadowEnvironment.installHeadlessEnvironment({entropy:new Uint8Array(buffer)," +
                "refillEntropy:async()=>{throw Error('offline');},scheduleTimer:(id,delay,repeat)=>timers.push({id,delay,repeat}),cancelTimer:id=>canceled.push(id)});" +
                "try {" +
                "const url=new URL('https://example.com/a?x=1&x=2');" +
                "const text=new TextDecoder().decode(new TextEncoder().encode('暗影'));" +
                "const abort=new AbortController();abort.abort('fictional-cancellation');let reason;try{abort.signal.throwIfAborted();}catch(e){reason=e;}" +
                "const timeoutSignal=AbortSignal.timeout(5);host.fireTimer(timers[timers.length-1].id);" +
                "const combined=AbortSignal.any([abort.signal,timeoutSignal]);const staticAbort=AbortSignal.abort('static-cancellation');" +
                "const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('abc'))),b=>b.toString(16).padStart(2,'0')).join('');" +
                "const hex=v=>Uint8Array.from(v.match(/../g),s=>parseInt(s,16));" +
                "const key=await crypto.subtle.importKey('raw',hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),'Ed25519',false,['verify']);" +
                "const sig=hex('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');" +
                "const verified=await crypto.subtle.verify('Ed25519',key,sig,new Uint8Array());" +
                "const invalid=await crypto.subtle.verify('Ed25519',key,sig,new Uint8Array([1]));" +
                "const original={a:{b:1}};const copied=structuredClone(original);copied.a.b=2;" +
                "const timer=setTimeout(()=>calls++,10);host.fireTimer(timer);host.fireTimer(timer);const pending=setTimeout(()=>calls++,20);" +
                "const uuid=crypto.randomUUID();host.close();host.fireTimer(pending);" +
                "return JSON.stringify({hostname:url.hostname,values:url.searchParams.getAll('x'),text,reason,timeoutReason:timeoutSignal.reason.name,combinedReason:combined.reason,staticReason:staticAbort.reason,digest,verified,invalid,copyPreserved:original.a.b===1,uuid,calls,canceled:canceled.includes(pending),hasDocument:typeof document!=='undefined'});" +
                "}finally{host.close();}})"
            ).get(30, TimeUnit.SECONDS);
            java.util.Arrays.fill(entropy, (byte)0);
            org.json.JSONObject result = new org.json.JSONObject(report);
            assertEquals("example.com", result.getString("hostname"));
            assertEquals("[\"1\",\"2\"]", result.getJSONArray("values").toString());
            assertEquals("暗影", result.getString("text"));
            assertEquals("fictional-cancellation", result.getString("reason"));
            assertEquals("TimeoutError", result.getString("timeoutReason"));
            assertEquals("fictional-cancellation", result.getString("combinedReason"));
            assertEquals("static-cancellation", result.getString("staticReason"));
            assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", result.getString("digest"));
            assertTrue(result.getBoolean("verified")); assertFalse(result.getBoolean("invalid"));
            assertTrue(result.getBoolean("copyPreserved")); assertTrue(result.getBoolean("canceled"));
            assertEquals(1, result.getInt("calls")); assertFalse(result.getBoolean("hasDocument"));
            assertTrue(result.getString("uuid").matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"));
        }
    }
    @Test public void messagePortCapabilityIsCheckedBeforeUse() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (JavaScriptSandbox sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context).get(30, TimeUnit.SECONDS)) {
            boolean ports = sandbox.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_MESSAGE_PORTS);
            android.util.Log.i("ShadowBackgroundCapability", "messagePorts=" + ports);
            try (JavaScriptIsolate isolate = sandbox.createIsolate()) {
                if (!ports) {
                    assertTrue("Byte transport is required when ports are unavailable",
                        sandbox.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER));
                    assertEquals("undefined", isolate.evaluateJavaScriptAsync("typeof android.getNamedPort").get(10, TimeUnit.SECONDS));
                    return;
                }
                java.util.concurrent.CompletableFuture<String> received = new java.util.concurrent.CompletableFuture<>();
                MessagePort port = isolate.createMessageChannel("capability", Runnable::run,
                    message -> received.complete(message.getString()));
                // Install the listener before sending: the engine drops messages sent before this point.
                isolate.evaluateJavaScriptAsync("android.getNamedPort('capability').then(port => {port.onmessage = event => port.postMessage(event.data);return 'ready';})")
                    .get(10, TimeUnit.SECONDS);
                String data = "fictional\"; globalThis.compromised = true; //";
                port.postMessage(Message.createStringMessage(data));
                assertEquals(data, received.get(10, TimeUnit.SECONDS));
                assertEquals("false", isolate.evaluateJavaScriptAsync("String(globalThis.compromised === true)").get(10, TimeUnit.SECONDS));
            }
        }
    }
    @Test public void sharedLogicHostRunsWithoutActivityAndReceivesDataWithoutCodeInterpolation() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertTrue("Headless engine must be available on the actual device", JavaScriptSandbox.isSupported());
        try (JavaScriptSandbox sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context).get(30, TimeUnit.SECONDS)) {
            for (String required : new String[]{ JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN,
                JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,
                JavaScriptSandbox.JS_FEATURE_CONSOLE_MESSAGING,
                JavaScriptSandbox.JS_FEATURE_ISOLATE_TERMINATION })
                assertTrue("Required headless capability: " + required, sandbox.isFeatureSupported(required));
            try (JavaScriptIsolate isolate = sandbox.createIsolate()) {
                String payload = "fictional\"; globalThis.compromised = true; //";
                isolate.provideNamedData("payload", payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                String result = isolate.evaluateJavaScriptAsync(
                    "android.consumeNamedDataAsArrayBuffer('payload').then(buffer => " +
                    "JSON.stringify({bytes:Array.from(new Uint8Array(buffer)),compromised:globalThis.compromised===true,hasDocument:typeof document!=='undefined'}))"
                ).get(30, TimeUnit.SECONDS);
                org.json.JSONObject received = new org.json.JSONObject(result);
                assertFalse("Input data must never execute as JavaScript", received.getBoolean("compromised"));
                assertFalse("Background host must not create a document", received.getBoolean("hasDocument"));
                org.json.JSONArray bytes = received.getJSONArray("bytes");
                byte[] actual = new byte[bytes.length()];
                for (int i = 0; i < bytes.length(); i++) actual[i] = (byte)bytes.getInt(i);
                assertArrayEquals(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8), actual);
            }
        }
    }
}
