package com.dsanying.shadowvpn.app;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public class NativeHttpClientTest {
    @Test public void rejectsTlsDowngradeAndEmbeddedCredentials() throws Exception {
        assertEquals("https", NativeHttpClient.validateUrl("https://example.com/subscription").getProtocol());
        assertThrows(IllegalArgumentException.class, () -> NativeHttpClient.validateUrl("http://example.com/subscription"));
        assertThrows(IllegalArgumentException.class, () -> NativeHttpClient.validateUrl("https://fixture:fixture@example.com/subscription"));
        assertThrows(Exception.class, () -> NativeHttpClient.validateUrl("file:///configuration"));
    }
    @Test public void limitsActualBytesEvenWhenTheResponseHasNoLengthHeader() throws Exception {
        byte[] text = "订阅".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(text, NativeHttpClient.readBounded(new ByteArrayInputStream(text), new AtomicBoolean()));
        assertThrows(IllegalArgumentException.class, () -> NativeHttpClient.readBounded(new ByteArrayInputStream(new byte[NativeHttpClient.MAX_BYTES + 1]), new AtomicBoolean()));
    }
    @Test public void cancellationCannotBecomeAnEmptySuccessfulResponse() {
        assertThrows(CancellationException.class, () -> NativeHttpClient.readBounded(new ByteArrayInputStream(new byte[0]), new AtomicBoolean(true)));
    }
}
