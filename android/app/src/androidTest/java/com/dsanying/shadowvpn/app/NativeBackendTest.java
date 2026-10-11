package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import io.nekohasekai.libbox.Libbox;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CompletableFuture;
import static org.junit.Assert.*;

/** Real JNI/database checks. These do not substitute for authorized VPN traffic tests. */
@RunWith(AndroidJUnit4.class)
public class NativeBackendTest {
    @Test public void largeUnicodeDocumentsRetainByteBoundariesAndAtomicVersions() {
        String name="test.large-unicode";
        String content="a".repeat(262143)+"中文🙂\u0000"+"界".repeat(800000);
        try(NativeStateStore store=new NativeStateStore(context())) {
            store.delete(name);
            try {
                String version=store.compareAndWrite(name,content,null);
                assertEquals(content,store.read(name));
                assertThrows(NativeStateStore.Conflict.class,()->store.compareAndWrite(name,"stale","incorrect-version"));
                assertEquals(content,store.read(name));
                store.compareAndWrite(name,"updated",version);
                assertEquals("updated",store.read(name));
            }finally{store.delete(name);}
        }
    }
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    @Test public void catalogTrustDocumentIsAccessibleWithoutExposingNativeResumeState() {
        NativeStateStore.publicDocument("release-catalog-trust");
        NativeStateStore.publicDocument("maintenance-cycle");
        assertThrows(IllegalArgumentException.class, () -> NativeStateStore.publicDocument("native.vpn.resume"));
        assertThrows(IllegalArgumentException.class, () -> NativeStateStore.publicDocument("unknown-document"));
    }
    @Test public void maintenanceReceiptSurvivesClosingItsDatabaseOwner() {
        String document = "maintenance-cycle";
        NativeStateStore store = new NativeStateStore(context());
        String previous = store.read(document);
        String receipt = "{\"schema\":1,\"attemptedAt\":123456789}";
        try {
            store.write(document, receipt);
        } finally { store.close(); }
        NativeStateStore reopened = new NativeStateStore(context());
        try {
            assertEquals(receipt, reopened.read(document));
        } finally {
            if (previous == null) reopened.delete(document); else reopened.write(document, previous);
            reopened.close();
        }
    }
    @Test public void loadsPinnedEngineAndValidatesNativeConfig() throws Exception {
        NativeRuntime.initialize(context());
        assertEquals("1.14.3", Libbox.version());
        String config = "{\"inbounds\":[{\"type\":\"tun\",\"tag\":\"tun\",\"address\":[\"172.19.0.1/30\"],\"auto_route\":true}],\"outbounds\":[{\"type\":\"direct\",\"tag\":\"direct\"}],\"route\":{\"final\":\"direct\"}}";
        Libbox.checkConfig(config);
        assertTrue(Libbox.hasTunInbound(config));
        assertThrows(Exception.class, () -> Libbox.checkConfig("{\"outbounds\":[{\"type\":\"not-a-real-protocol\"}]}"));
    }
    @Test public void smartRegionReadsRealLocalResourceWithPinnedNativeEngine() throws Exception {
        NativeRuntime.initialize(context());
        java.io.File directory = new java.io.File(context().getFilesDir(), "routing-data");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        java.io.File resource = new java.io.File(directory, "geoip-cn.srs");
        try (java.io.InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("geoip-cn.srs");
             java.io.FileOutputStream output = new java.io.FileOutputStream(resource)) {
            byte[] bytes = new byte[8192]; int count;
            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
            output.getFD().sync();
        }
        NativeHttpClient transport = new NativeHttpClient(context());
        NativeRuleSets rules = new NativeRuleSets(context(), transport);
        try {
            com.getcapacitor.JSObject prepared = rules.prepare("CN", false);
            assertEquals("geoip-cn", prepared.getString("tag"));
            assertEquals(resource.getAbsolutePath(), prepared.getString("path"));
            org.json.JSONObject config = new org.json.JSONObject();
            config.put("outbounds", new org.json.JSONArray("[{\"type\":\"direct\",\"tag\":\"direct\"}]"));
            org.json.JSONObject route = new org.json.JSONObject();
            org.json.JSONObject local = new org.json.JSONObject(prepared.toString()); local.put("type", "local");
            route.put("rule_set", new org.json.JSONArray().put(local));
            route.put("rules", new org.json.JSONArray("[{\"rule_set\":[\"geoip-cn\"],\"outbound\":\"direct\"}]"));
            route.put("final", "direct"); config.put("route", route);
            Libbox.checkConfig(config.toString());
        } finally { rules.close(); transport.close(); assertTrue(resource.delete()); }
    }
    @Test public void persistsAcrossStoreReopeningAndDeletesExactlyOneDocument() {
        NativeStateStore store = new NativeStateStore(context());
        try { store.write("test.configuration", "{\"servers\":[]}"); store.write("test.measurement", "{\"latency\":37}"); } finally { store.close(); }
        NativeStateStore reopened = new NativeStateStore(context());
        try {
            assertEquals("{\"servers\":[]}", reopened.read("test.configuration"));
            assertThrows(IllegalArgumentException.class, () -> reopened.write("../escape", "bad"));
            assertEquals("{\"servers\":[]}", reopened.read("test.configuration"));
            reopened.delete("test.configuration"); assertNull(reopened.read("test.configuration"));
            assertEquals("{\"latency\":37}", reopened.read("test.measurement"));
        } finally { reopened.delete("test.configuration"); reopened.delete("test.measurement"); reopened.close(); }
    }
    @Test public void refusesOverlappingCommandsAndPropagatesActualFailure() {
        CompletableFuture<?> first = NativeRuntime.begin();
        assertThrows(IllegalStateException.class, NativeRuntime::begin);
        assertFalse(first.isDone());
        NativeRuntime.complete(false, "fixture permission denied");
        assertTrue(first.isCompletedExceptionally());
        assertFalse(NativeRuntime.status().getBoolean("running", true));
        assertEquals("fixture permission denied", NativeRuntime.status().getString("error"));
        CompletableFuture<?> next = NativeRuntime.begin();
        NativeRuntime.complete(false, null);
        assertTrue(next.isDone()); assertFalse(next.isCompletedExceptionally());
    }
    @Test public void failedSqliteInsertCannotReportSuccessOrDestroyPreviousData() {
        NativeStateStore store = new NativeStateStore(context());
        try {
            store.write("test.failure", "previous");
            store.getWritableDatabase().execSQL("CREATE TEMP TRIGGER reject_fixture BEFORE INSERT ON documents WHEN NEW.name='test.failure' BEGIN SELECT RAISE(IGNORE); END");
            assertThrows(android.database.sqlite.SQLiteException.class, () -> store.write("test.failure", "replacement"));
            assertEquals("previous", store.read("test.failure"));
        } finally {
            store.getWritableDatabase().execSQL("DROP TRIGGER IF EXISTS reject_fixture");
            store.delete("test.failure");
            store.close();
        }
    }
    @Test public void nativeRecoverySurvivesReopeningAndExplicitDisconnectClearsIt() throws Exception {
        NativeStateStore first = new NativeStateStore(context());
        String config = "{\"outbounds\":[{\"type\":\"direct\",\"tag\":\"direct\"}]}";
        org.json.JSONObject nodes = new org.json.JSONObject(); nodes.put("fictional-node", "a".repeat(64));
        try { new NativeVpnJournal(first).committed(config, nodes); } finally { first.close(); }
        NativeStateStore reopened = new NativeStateStore(context());
        try {
            NativeVpnJournal journal = new NativeVpnJournal(reopened);
            assertEquals(config, journal.read());
            assertEquals(nodes.toString(), journal.readRecord().getJSONObject("nodes").toString());
            journal.clear(); assertNull(journal.read());
            reopened.write("native.vpn.resume", "{\"schema\":99,\"config\":\"invalid\"}");
            assertThrows(IllegalStateException.class, journal::read);
            assertNull(reopened.read("native.vpn.resume"));
        } finally { reopened.delete("native.vpn.resume"); reopened.close(); }
    }
    @Test public void failedRecoveryWritePreservesPreviousCommittedTunnel() throws Exception {
        NativeStateStore store = new NativeStateStore(context());
        try {
            NativeVpnJournal journal = new NativeVpnJournal(store);
            journal.committed("{\"outbounds\":[]}");
            store.getWritableDatabase().execSQL("CREATE TEMP TRIGGER reject_resume BEFORE INSERT ON documents WHEN NEW.name='native.vpn.resume' BEGIN SELECT RAISE(IGNORE); END");
            assertThrows(android.database.sqlite.SQLiteException.class, () -> journal.committed("replacement"));
            assertEquals("{\"outbounds\":[]}", journal.read());
        } finally {
            store.getWritableDatabase().execSQL("DROP TRIGGER IF EXISTS reject_resume");
            store.delete("native.vpn.resume"); store.close();
        }
    }
    @Test public void staleWriterCannotOverwriteAnotherStoreCommit() {
        NativeStateStore first = new NativeStateStore(context()), second = new NativeStateStore(context());
        String name = "test.cas";
        try {
            first.delete(name);
            String version = first.compareAndWrite(name, "first", null);
            assertEquals(NativeStateStore.revision("first"), version);
            second.compareAndWrite(name, "newer", version);
            assertThrows(NativeStateStore.Conflict.class, () -> first.compareAndWrite(name, "stale", version));
            assertEquals("newer", first.read(name));
            assertThrows(NativeStateStore.Conflict.class, () -> first.compareAndWrite(name, "replace", null));
        } finally { first.delete(name); first.close(); second.close(); }
    }
}
