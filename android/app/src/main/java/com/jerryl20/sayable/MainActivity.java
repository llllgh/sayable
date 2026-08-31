package com.jerryl20.sayable;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CloudSpeechPlugin.class);
        registerPlugin(ShareInboxPlugin.class);
        registerPlugin(RecallNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
