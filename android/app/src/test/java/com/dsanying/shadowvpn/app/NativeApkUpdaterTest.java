package com.dsanying.shadowvpn.app;

import org.junit.Test;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public class NativeApkUpdaterTest {
    @Test public void allDownloadPathsShareTheRemainingBudget() throws Exception {
        assertEquals(180000, NativeApkUpdater.remainingDownloadTime(300000, 0));
        assertEquals(120000, NativeApkUpdater.remainingDownloadTime(300000, 180000));
        assertEquals(1, NativeApkUpdater.remainingDownloadTime(300000, 299999));
        assertThrows(java.io.IOException.class, () -> NativeApkUpdater.remainingDownloadTime(300000, 300000));
        assertThrows(java.io.IOException.class, () -> NativeApkUpdater.remainingDownloadTime(300000, 300001));
    }
    private static final String SOURCE = "https://github.com/dsanying/VPN/releases/download/v0.1.1/app-release.apk";
    private static final String HASH = "sha256:" + "a".repeat(64);
    @Test public void validatesPublisherVersionAndDigestWithoutTrustingTransport() throws Exception {
        NativeApkUpdater.validateAsset(SOURCE, "0.1.1", HASH);
        for (String url : new String[]{SOURCE.replace("dsanying/VPN", "other/project"), SOURCE.replace("https:", "http:"), SOURCE + "?token=wrong", SOURCE.replace("github.com", "github.com:443"), SOURCE.replace("app-release.apk", "nested/file.apk"), SOURCE.replace("app-release.apk", "%2e%2e%2ffile.apk")})
            assertThrows(IllegalArgumentException.class, () -> NativeApkUpdater.validateAsset(url, "0.1.1", HASH));
        assertThrows(IllegalArgumentException.class, () -> NativeApkUpdater.validateAsset(SOURCE, "0.1.2", HASH));
        assertThrows(IllegalArgumentException.class, () -> NativeApkUpdater.validateAsset(SOURCE, "0.1.1", "sha256:bad"));
    }
    @Test public void mirrorMustTransportExactlyTheSamePublisherAsset() {
        assertTrue(NativeApkUpdater.transportAllowed(SOURCE, SOURCE));
        assertTrue(NativeApkUpdater.transportAllowed(SOURCE, "https://ghproxy.net/" + SOURCE));
        assertFalse(NativeApkUpdater.transportAllowed(SOURCE, "https://example.com/" + SOURCE));
        assertFalse(NativeApkUpdater.transportAllowed(SOURCE, "https://ghproxy.net/" + SOURCE + "?other=asset"));
        assertFalse(NativeApkUpdater.transportAllowed(SOURCE, SOURCE.replace("0.1.1", "0.1.2")));
    }
    @Test public void hashesActualStoredBytesAndDetectsTampering() throws Exception {
        File file = File.createTempFile("shadow-update-", ".apk");
        try {
            Files.write(file.toPath(), "abc".getBytes(StandardCharsets.UTF_8));
            assertEquals("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", NativeApkUpdater.digest(file));
            Files.write(file.toPath(), "abd".getBytes(StandardCharsets.UTF_8));
            assertNotEquals("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", NativeApkUpdater.digest(file));
        } finally { file.delete(); }
    }
}
