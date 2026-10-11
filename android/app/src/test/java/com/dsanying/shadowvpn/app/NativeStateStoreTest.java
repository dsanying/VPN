package com.dsanying.shadowvpn.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class NativeStateStoreTest {
    @Test public void internalStateIsNotWritableThroughThePublicBridge() {
        NativeStateStore.publicDocument("config"); NativeStateStore.publicDocument("node-measurements");
        assertThrows(IllegalArgumentException.class, () -> NativeStateStore.publicDocument("native.vpn.resume"));
        assertThrows(IllegalArgumentException.class, () -> NativeStateStore.publicDocument("native.update.apk"));
        assertThrows(IllegalArgumentException.class, () -> NativeStateStore.publicDocument("../config"));
    }
    @Test public void revisionIdentifiesStoredBytesAndMissingDocument() {
        assertNull(NativeStateStore.revision(null));
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", NativeStateStore.revision("abc"));
        assertNotEquals(NativeStateStore.revision("abc"), NativeStateStore.revision("abcd"));
    }
}
