package com.jerryl20.sayable;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class RecallAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        RecallNotificationsPlugin.show(context, intent);
    }
}
