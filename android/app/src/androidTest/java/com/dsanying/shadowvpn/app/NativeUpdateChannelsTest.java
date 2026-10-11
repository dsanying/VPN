package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.security.MessageDigest;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual host downloads using a publisher-authenticated immutable asset digest, not a mirror digest. */
@RunWith(AndroidJUnit4.class)
public class NativeUpdateChannelsTest {
    @Test public void independentDownloadChannelsReturnIdenticalAuthenticatedAsset() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String official = "https://github.com/SagerNet/sing-box/releases/download/v1.14.3/SFA-version-metadata.json";
        // Published GitHub asset digest, verified against the signed publisher catalog on 2026-10-11.
        String expected = "52cb65c675987428a82aaf5aa160c81f5a906c662084c4f04e3a2a64deb7ebea";
        String[] channels = { official, "https://ghproxy.net/" + official, "https://gh-proxy.org/" + official };
        NativeHttpClient transport = new NativeHttpClient(context);
        try {
            for (String channel : channels) {
                File destination = File.createTempFile("update-channel-test-", ".json", context.getCacheDir());
                try {
                    transport.request().download(channel, "direct", destination, 1024 * 1024, 30000);
                    byte[] downloaded = Files.readAllBytes(destination.toPath());
                    assertEquals("Publisher asset size must match", 54, downloaded.length);
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(downloaded);
                    StringBuilder actual = new StringBuilder();
                    for (byte value : digest) actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                    assertEquals("Channel must preserve publisher bytes: " + new java.net.URL(channel).getHost(), expected, actual.toString());
                } finally { assertTrue("Test download must be removed", destination.delete()); }
            }
        } finally { transport.close(); }
    }
}
