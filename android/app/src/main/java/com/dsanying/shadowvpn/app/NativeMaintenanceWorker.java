package com.dsanying.shadowvpn.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import java.util.concurrent.TimeUnit;

/** One durable OS wake-up; the shared receipt controls actual six-hour work across restarts. */
public final class NativeMaintenanceWorker extends Worker {
    static final String UNIQUE_NAME="shadowvpn-business-maintenance";
    private volatile NativeBusinessHost host;
    public NativeMaintenanceWorker(@NonNull Context context,@NonNull WorkerParameters parameters){super(context,parameters);}
    static Operation schedule(Context context){
        PeriodicWorkRequest request=new PeriodicWorkRequest.Builder(NativeMaintenanceWorker.class,6,TimeUnit.HOURS)
            .setInitialDelay(6,TimeUnit.HOURS)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        return WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_NAME,ExistingPeriodicWorkPolicy.KEEP,request);
    }
    @NonNull @Override public Result doWork(){
        try{
            host=NativeBusinessHost.get(getApplicationContext()).get(120,TimeUnit.SECONDS);
            if(isStopped())return Result.failure();
            host.maintain().get(8,TimeUnit.MINUTES);
            return Result.success();
        }catch(Exception error){
            // The next scheduled cycle retries. Do not turn provider failure into repeated short polling.
            return Result.failure();
        }finally{NativeBusinessHost current=host;if(current!=null)current.releaseBackground();}
    }
    @Override public void onStopped(){NativeBusinessHost current=host;if(current!=null)current.releaseBackground();}
}
