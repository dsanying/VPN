package com.dsanying.shadowvpn.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
public class NativeDocumentIOTest {
    @Test public void unicodeRoundTrip() throws Exception {
        String value = "{\"名称\":\"虚构节点 🔒\"}";
        assertEquals(value, NativeDocumentIO.read(new ByteArrayInputStream(NativeDocumentIO.encode(value))));
    }
    @Test public void malformedUtf8IsRejected() throws Exception {
        try { NativeDocumentIO.read(new ByteArrayInputStream(new byte[]{(byte)0xc3, 0x28})); fail("invalid UTF-8 accepted"); }
        catch (java.nio.charset.CharacterCodingException expected) { }
    }
    @Test public void streamOverSizeLimitIsRejectedBeforeDecode() throws Exception {
        InputStream bytes = new InputStream() {
            int remaining = NativeDocumentIO.MAX_BYTES + 1;
            public int read() { if (remaining-- > 0) return 97; return -1; }
            public int read(byte[] buffer, int offset, int length) {
                if (remaining <= 0) return -1;
                int count = Math.min(length, remaining); java.util.Arrays.fill(buffer, offset, offset + count, (byte)97); remaining -= count; return count;
            }
        };
        try { NativeDocumentIO.read(bytes); fail("oversized content accepted"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("大小")); }
    }
}
