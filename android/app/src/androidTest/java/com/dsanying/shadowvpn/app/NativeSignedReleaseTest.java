package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.security.MessageDigest;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Explicit signed-artifact checks on a disposable emulator; never use a real user's profile. */
@RunWith(AndroidJUnit4.class)
public class NativeSignedReleaseTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    @Test public void installedArtifactIsReleaseWithExpectedIdentity() throws Exception {
        PackageInfo installed = context().getPackageManager().getPackageInfo(context().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        assertEquals("com.dsanying.shadowvpn.app", installed.packageName);
        assertEquals(0, installed.applicationInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE);
        String version = InstrumentationRegistry.getArguments().getString("expectedVersion");
        String certificate = InstrumentationRegistry.getArguments().getString("expectedCertificate");
        assertNotNull("Expected version must be supplied by the artifact runner", version);
        assertNotNull("Expected signing certificate must be supplied by the artifact runner", certificate);
        assertEquals(version, installed.versionName);
        String commit = InstrumentationRegistry.getArguments().getString("expectedCommit");
        if (commit != null) {
            // Read classes from the installed target, not the newer instrumentation APK.
            Class<?> identity = context().getClassLoader().loadClass("com.dsanying.shadowvpn.app.BuildConfig");
            assertEquals(commit, identity.getField("SOURCE_COMMIT").get(null));
            assertEquals(InstrumentationRegistry.getArguments().getString("expectedDirty"),
                String.valueOf(identity.getField("SOURCE_DIRTY").get(null)));
        }
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(installed.signingInfo.getApkContentsSigners()[0].toByteArray());
        StringBuilder actual = new StringBuilder();
        for (byte value : digest) actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        assertEquals(certificate, actual.toString());
    }
    @Test public void privateDatabaseSurvivesPackageReplacement() {
        String stage = InstrumentationRegistry.getArguments().getString("retentionStage");
        String marker = InstrumentationRegistry.getArguments().getString("retentionMarker");
        assertNotNull(marker);
        assertTrue("Explicit seed/verify stage is required", "seed".equals(stage) || "verify".equals(stage));
        try (NativeStateStore store = new NativeStateStore(context())) {
            if ("seed".equals(stage)) store.write("test.release.retention", marker);
            assertEquals(marker, store.read("test.release.retention"));
            if ("verify".equals(stage)) store.delete("test.release.retention");
        }
    }
}
