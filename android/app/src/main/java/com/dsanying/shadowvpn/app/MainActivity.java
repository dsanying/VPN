package com.dsanying.shadowvpn.app;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) { registerPlugin(ShadowVpnPlugin.class); super.onCreate(state); }
}
