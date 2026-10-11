package com.dsanying.shadowvpn.app;

import org.junit.Test;
import java.io.File;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class NativeRuleSetsTest {
    @Test public void countryCannotBecomeAnImportedPathOrArbitraryUrl() {
        assertEquals("cn", NativeRuleSets.country("CN"));
        assertEquals("de", NativeRuleSets.country("de"));
        for (String value : new String[]{"XX", "../cn", "https://evil.invalid", "C", "CHN", " CN", "cn/"}) {
            try { NativeRuleSets.country(value); fail(value); } catch (IllegalArgumentException expected) { }
        }
    }
    @Test public void invalidOrTruncatedResourceIsNeverUsed() throws Exception {
        File file = File.createTempFile("shadow-rules-", ".srs");
        try {
            for (byte[] value : new byte[][]{new byte[0], "SRS".getBytes(), "<html>failure</html>".getBytes()}) {
                Files.write(file.toPath(), value); assertFalse(NativeRuleSets.valid(file));
            }
            Files.write(file.toPath(), new byte[]{'S', 'R', 'S', 4}); assertTrue(NativeRuleSets.valid(file));
        } finally { Files.delete(file.toPath()); }
    }
}
