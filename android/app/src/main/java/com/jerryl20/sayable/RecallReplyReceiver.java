package com.jerryl20.sayable;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class RecallReplyReceiver extends BroadcastReceiver {
    private static final int MAX_PENDING_REPLIES = 30;

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results == null) return;
        CharSequence value = results.getCharSequence(
            RecallNotificationsPlugin.REMOTE_INPUT_KEY
        );
        if (value == null || value.toString().trim().isEmpty()) return;

        SharedPreferences preferences = context.getSharedPreferences(
            RecallNotificationsPlugin.REPLY_PREFERENCES,
            Context.MODE_PRIVATE
        );
        try {
            JSONArray current = new JSONArray(
                preferences.getString(RecallNotificationsPlugin.REPLY_ITEMS, "[]")
            );
            JSONArray retained = new JSONArray();
            int first = Math.max(0, current.length() - MAX_PENDING_REPLIES + 1);
            for (int index = first; index < current.length(); index++) {
                retained.put(current.get(index));
            }
            JSONObject reply = new JSONObject();
            reply.put("itemId", intent.getStringExtra("itemId"));
            reply.put("answer", value.toString().trim());
            reply.put("receivedAt", System.currentTimeMillis());
            retained.put(reply);
            preferences.edit()
                .putString(RecallNotificationsPlugin.REPLY_ITEMS, retained.toString())
                .commit();
        } catch (JSONException ignored) {
            preferences.edit()
                .remove(RecallNotificationsPlugin.REPLY_ITEMS)
                .apply();
        }

        int notificationId = intent.getIntExtra("id", 0);
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
            .cancel(notificationId);
    }
}
