package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.*;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class NativeBackgroundLifecycleTest {
    @Test public void repeatedApplicationSchedulingRetainsOneDurableSixHourJob() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeMaintenanceWorker.schedule(context).getResult().get(10,TimeUnit.SECONDS);
        java.util.List<WorkInfo> first=WorkManager.getInstance(context).getWorkInfosForUniqueWork(NativeMaintenanceWorker.UNIQUE_NAME).get(10,TimeUnit.SECONDS);
        assertEquals(1,first.size());
        WorkInfo info=first.get(0);
        assertNotNull(info.getPeriodicityInfo());
        assertEquals(TimeUnit.HOURS.toMillis(6),info.getPeriodicityInfo().getRepeatIntervalMillis());
        assertEquals(TimeUnit.HOURS.toMillis(6),info.getInitialDelayMillis());
        assertEquals(NetworkType.CONNECTED,info.getConstraints().getRequiredNetworkType());
        NativeMaintenanceWorker.schedule(context).getResult().get(10,TimeUnit.SECONDS);
        java.util.List<WorkInfo> again=WorkManager.getInstance(context).getWorkInfosForUniqueWork(NativeMaintenanceWorker.UNIQUE_NAME).get(10,TimeUnit.SECONDS);
        assertEquals(1,again.size());assertEquals(info.getId(),again.get(0).getId());
    }
    @Test public void backgroundOwnerRecreationHonorsSavedCadenceWithoutActivity() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try(NativeStateStore store=new NativeStateStore(context)){
            String previous=store.read("maintenance-cycle");
            long now=System.currentTimeMillis();
            String receipt=new JSONObject().put("schema",1).put("attemptedAt",now).toString();
            store.write("maintenance-cycle",receipt);
            NativeBusinessHost first=null,second=null;
            try{
                first=NativeBusinessHost.get(context).get(90,TimeUnit.SECONDS);
                assertEquals(now+TimeUnit.HOURS.toMillis(6),Long.parseLong(first.maintain().get(30,TimeUnit.SECONDS)));
                first.releaseBackground();
                second=NativeBusinessHost.get(context).get(90,TimeUnit.SECONDS);
                assertNotSame(first,second);
                assertEquals(now+TimeUnit.HOURS.toMillis(6),Long.parseLong(second.maintain().get(30,TimeUnit.SECONDS)));
                assertEquals(receipt,store.read("maintenance-cycle"));
            }finally{
                if(first!=null)first.releaseBackground();if(second!=null)second.releaseBackground();
                if(previous==null)store.delete("maintenance-cycle");else store.write("maintenance-cycle",previous);
            }
        }
    }
}
