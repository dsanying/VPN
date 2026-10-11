package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.content.Intent;
import android.os.Parcel;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class NativeVpnLaunchTest {
    @Test public void largeLaunchUsesSmallIntentAndOneTimePrivateRecord() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String config=new JSONObject().put("fictionalPayload","x".repeat(2*1024*1024)).toString();
        try(NativeStateStore store=new NativeStateStore(context)){
            NativeVpnLaunchRequest launch=new NativeVpnLaunchRequest(store);
            String token=launch.stage(config,new JSONObject());
            Intent intent=new Intent(context,ShadowVpnService.class).putExtra(ShadowVpnService.EXTRA_REQUEST,token);
            Parcel parcel=Parcel.obtain();
            try{intent.writeToParcel(parcel,0);assertTrue("Large configuration must stay out of Binder",parcel.dataSize()<4096);}finally{parcel.recycle();}
            assertThrows(IllegalStateException.class,()->launch.consume("fictional-wrong-token"));
            assertEquals(config,launch.consume(token).getString("config"));
            assertThrows(IllegalStateException.class,()->launch.consume(token));
            assertNull("Unconfirmed launch cannot become boot recovery",new NativeVpnJournal(store).read());
            String canceled=launch.stage("{}",new JSONObject());
            launch.cancel("fictional-stale-token");
            assertEquals("{}",launch.consume(canceled).getString("config"));
            launch.cancel(launch.stage("{}",new JSONObject()));
            assertNull(store.read("native.vpn.pending"));
        }
    }
}
