package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeNetworkDeviceTest {
    @Test public void repeatedPhysicalNetworkObservationsDoNotMutateVpnPath() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AtomicInteger notifications = new AtomicInteger();
        CountDownLatch available = new CountDownLatch(1);
        NativeNetworkPlatform adapter = new NativeNetworkPlatform(context, null, network -> {
            notifications.incrementAndGet();
            if (network != null) available.countDown();
        });
        try {
            adapter.startNetworkMonitor();
            assertTrue("The isolated device requires an actual physical network", available.await(10, TimeUnit.SECONDS));
            assertTrue(adapter.hasPhysicalNetwork());
            int initial = notifications.get();
            Method observe = NativeNetworkPlatform.class.getDeclaredMethod("updateNetwork");
            observe.setAccessible(true);
            // Different Android callback types converge on the same observation path.
            for (int event = 0; event < 100; event++) observe.invoke(adapter);
            assertEquals("A repeated callback must not reset the VPN underlying network", initial, notifications.get());
            adapter.close();
            observe.invoke(adapter);
            assertEquals("Late callbacks after disposal must be inert", initial, notifications.get());
        } finally { adapter.close(); }
    }
}
