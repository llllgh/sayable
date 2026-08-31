package com.jerryl20.sayable;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class ShareReceiverActivity extends Activity {
    private static final int MAX_PENDING_ITEMS = 100;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        capture(getIntent());
        finishAndRemoveTask();
    }

    private void capture(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (shared == null || shared.toString().trim().isEmpty()) return;

        SharedPreferences preferences = getSharedPreferences(
            ShareInboxPlugin.PREFERENCES,
            MODE_PRIVATE
        );
        try {
            JSONArray current = new JSONArray(
                preferences.getString(ShareInboxPlugin.ITEMS, "[]")
            );
            JSONArray retained = new JSONArray();
            int first = Math.max(0, current.length() - MAX_PENDING_ITEMS + 1);
            for (int index = first; index < current.length(); index++) {
                retained.put(current.get(index));
            }
            JSONObject item = new JSONObject();
            item.put("text", shared.toString().trim());
            item.put("receivedAt", System.currentTimeMillis());
            retained.put(item);
            preferences.edit()
                .putString(ShareInboxPlugin.ITEMS, retained.toString())
                .commit();
        } catch (JSONException ignored) {
            preferences.edit().remove(ShareInboxPlugin.ITEMS).commit();
        }
    }
}
