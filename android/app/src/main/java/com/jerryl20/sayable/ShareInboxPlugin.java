package com.jerryl20.sayable;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

@CapacitorPlugin(name = "ShareInbox")
public class ShareInboxPlugin extends Plugin {
    static final String PREFERENCES = "sayable_share_inbox";
    static final String ITEMS = "items";

    @PluginMethod
    public void consume(PluginCall call) {
        SharedPreferences preferences = getContext()
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String raw = preferences.getString(ITEMS, "[]");

        try {
            JSArray items = new JSArray(raw);
            preferences.edit().remove(ITEMS).commit();
            JSObject result = new JSObject();
            result.put("items", items);
            call.resolve(result);
        } catch (JSONException error) {
            preferences.edit().remove(ITEMS).commit();
            call.reject("Invalid shared text queue", error);
        }
    }
}
