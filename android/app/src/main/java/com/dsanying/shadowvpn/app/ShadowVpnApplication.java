package com.dsanying.shadowvpn.app;

import android.app.Application;

/** Schedule once per process creation; WorkManager keeps one persisted system job. */
public final class ShadowVpnApplication extends Application {
    @Override public void onCreate(){super.onCreate();try(NativeStateStore store=new NativeStateStore(this)){new NativeVpnLaunchRequest(store).clear();}NativeMaintenanceWorker.schedule(this);}
}
