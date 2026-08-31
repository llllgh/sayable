package com.jerryl20.sayable;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "RecallNotifications")
public class RecallNotificationsPlugin extends Plugin {
    static final String CHANNEL_ID = "sayable-recall";
    static final String SCHEDULE_PREFERENCES = "sayable_recall_schedule";
    static final String SCHEDULE_ITEMS = "items";
    static final String REPLY_PREFERENCES = "sayable_recall_replies";
    static final String REPLY_ITEMS = "items";
    static final String REMOTE_INPUT_KEY = "sayable_answer";

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray notifications = call.getArray("notifications");
        if (notifications == null) {
            call.reject("notifications is required");
            return;
        }
        try {
            scheduleAll(getContext(), notifications);
            JSObject result = new JSObject();
            result.put("count", notifications.length());
            call.resolve(result);
        } catch (JSONException error) {
            call.reject("Invalid notification payload", error);
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        cancelKnown(getContext());
        call.resolve();
    }

    @PluginMethod
    public void showTest(PluginCall call) {
        Intent notification = new Intent();
        notification.putExtra("id", 4199);
        notification.putExtra("itemId", call.getString("itemId", ""));
        notification.putExtra("title", "说得出 · 通知测试");
        notification.putExtra("body", call.getString("body", "通知与快捷回复已就绪"));
        show(getContext(), notification);
        call.resolve();
    }

    @PluginMethod
    public void consumeReplies(PluginCall call) {
        SharedPreferences preferences = getContext()
            .getSharedPreferences(REPLY_PREFERENCES, Context.MODE_PRIVATE);
        String raw = preferences.getString(REPLY_ITEMS, "[]");
        try {
            JSArray replies = new JSArray(raw);
            preferences.edit().remove(REPLY_ITEMS).commit();
            JSObject result = new JSObject();
            result.put("items", replies);
            call.resolve(result);
        } catch (JSONException error) {
            preferences.edit().remove(REPLY_ITEMS).commit();
            call.reject("Invalid reply queue", error);
        }
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        PowerManager manager = (PowerManager) getContext()
            .getSystemService(Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put(
            "value",
            manager != null && manager.isIgnoringBatteryOptimizations(
                getContext().getPackageName()
            )
        );
        call.resolve(result);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    static void scheduleAll(Context context, JSONArray notifications) throws JSONException {
        cancelKnown(context);
        for (int index = 0; index < notifications.length(); index++) {
            JSONObject notification = notifications.getJSONObject(index);
            scheduleOne(context, notification);
        }
        context.getSharedPreferences(SCHEDULE_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(SCHEDULE_ITEMS, notifications.toString())
            .commit();
    }

    static void restore(Context context) {
        String raw = context
            .getSharedPreferences(SCHEDULE_PREFERENCES, Context.MODE_PRIVATE)
            .getString(SCHEDULE_ITEMS, "[]");
        try {
            JSONArray notifications = new JSONArray(raw);
            for (int index = 0; index < notifications.length(); index++) {
                JSONObject notification = notifications.getJSONObject(index);
                if (notification.optLong("at", 0) > System.currentTimeMillis()) {
                    scheduleOne(context, notification);
                }
            }
        } catch (JSONException ignored) {
            context.getSharedPreferences(SCHEDULE_PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .remove(SCHEDULE_ITEMS)
                .apply();
        }
    }

    private static void cancelKnown(Context context) {
        String raw = context
            .getSharedPreferences(SCHEDULE_PREFERENCES, Context.MODE_PRIVATE)
            .getString(SCHEDULE_ITEMS, "[]");
        try {
            JSONArray current = new JSONArray(raw);
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            for (int index = 0; index < current.length(); index++) {
                int id = current.getJSONObject(index).optInt("id");
                alarms.cancel(alarmIntent(context, id));
                NotificationManagerCompat.from(context).cancel(id);
            }
        } catch (JSONException ignored) {
            // A malformed schedule is replaced by the next valid one.
        }
        context.getSharedPreferences(SCHEDULE_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .remove(SCHEDULE_ITEMS)
            .apply();
    }

    private static PendingIntent alarmIntent(Context context, int id) {
        Intent intent = new Intent(context, RecallAlarmReceiver.class);
        intent.setAction(context.getPackageName() + ".RECALL." + id);
        return PendingIntent.getBroadcast(
            context,
            id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void scheduleOne(Context context, JSONObject notification) {
        int id = notification.optInt("id");
        long at = notification.optLong("at");
        Intent intent = new Intent(context, RecallAlarmReceiver.class);
        intent.setAction(context.getPackageName() + ".RECALL." + id);
        intent.putExtra("id", id);
        intent.putExtra("itemId", notification.optString("itemId"));
        intent.putExtra("title", notification.optString("title", "说得出"));
        intent.putExtra("body", notification.optString("body"));
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarms.canScheduleExactAlarms()) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        } else {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
    }

    static void show(Context context, Intent source) {
        createChannel(context);
        int id = source.getIntExtra("id", 0);
        String itemId = source.getStringExtra("itemId");
        String title = source.getStringExtra("title");
        String body = source.getStringExtra("body");

        Intent open = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("sayable://drill/" + Uri.encode(itemId)),
            context,
            MainActivity.class
        );
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
            context,
            id,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        RemoteInput input = new RemoteInput.Builder(REMOTE_INPUT_KEY)
            .setLabel("说出或写出答案")
            .build();
        Intent reply = new Intent(context, RecallReplyReceiver.class);
        reply.setAction(context.getPackageName() + ".REPLY." + id);
        reply.putExtra("id", id);
        reply.putExtra("itemId", itemId);
        int replyFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            replyFlags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent replyPending = PendingIntent.getBroadcast(
            context,
            id + 10_000,
            reply,
            replyFlags
        );
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
            R.drawable.ic_stat_sayable,
            "作答",
            replyPending
        ).addRemoteInput(input).build();

        NotificationCompat.Builder notification = new NotificationCompat.Builder(
            context,
            CHANNEL_ID
        )
            .setSmallIcon(R.drawable.ic_stat_sayable)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPending)
            .addAction(replyAction);

        try {
            NotificationManagerCompat.from(context).notify(id, notification.build());
        } catch (SecurityException ignored) {
            // Permission can be revoked after the alarm was scheduled.
        }
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "到期召回",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("只在有到期表达时提醒");
        manager.createNotificationChannel(channel);
    }
}
