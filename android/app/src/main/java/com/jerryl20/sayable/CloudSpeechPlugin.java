package com.jerryl20.sayable;

import android.Manifest;
import android.annotation.SuppressLint;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "CloudSpeech",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class CloudSpeechPlugin extends Plugin {
    private static final int SAMPLE_RATE = 16_000;
    private static final int CHUNK_MS = 200;
    private static final int SUCCESS_CODE = 20_000_000;

    private final Object sessionLock = new Object();
    private final Object playerLock = new Object();
    private final AtomicBoolean recording = new AtomicBoolean(false);
    private final AtomicBoolean finished = new AtomicBoolean(true);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final okhttp3.OkHttpClient httpClient = new okhttp3.OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build();

    private PluginCall startCall;
    private WebSocket webSocket;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private NoiseSuppressor noiseSuppressor;
    private AcousticEchoCanceler echoCanceler;
    private MediaPlayer mediaPlayer;
    private PluginCall mediaPlayerCall;
    private volatile long recordingStartedAt;
    private volatile long voicedMs;
    private volatile int longPauses;
    private volatile int consecutiveSilenceMs;
    private volatile boolean heardVoice;

    @PluginMethod
    public void playAudio(PluginCall call) {
        String encoded = call.getString("data", "").trim();
        String cacheName = call.getString("cacheName", "speech.mp3")
            .replaceAll("[^A-Za-z0-9._-]", "_");
        if (encoded.isEmpty()) {
            call.reject("云端语音没有返回可播放音频");
            return;
        }

        stopAudioPlayback();
        MediaPlayer player = new MediaPlayer();
        boolean registered = false;
        try {
            File directory = new File(getContext().getCacheDir(), "speech");
            if (!directory.exists() && !directory.mkdirs()) {
                throw new IOException("无法创建语音缓存目录");
            }
            File audioFile = new File(directory, cacheName);
            byte[] audio = Base64.decode(encoded, Base64.DEFAULT);
            if (!audioFile.exists() || audioFile.length() != audio.length) {
                try (FileOutputStream output = new FileOutputStream(audioFile)) {
                    output.write(audio);
                }
            }

            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
            player.setDataSource(audioFile.getAbsolutePath());
            player.setOnPreparedListener(MediaPlayer::start);
            player.setOnCompletionListener(completed ->
                finishAudioPlayback(completed, null)
            );
            player.setOnErrorListener((failed, what, extra) -> {
                finishAudioPlayback(failed, "云端语音播放失败");
                return true;
            });
            synchronized (playerLock) {
                mediaPlayer = player;
                mediaPlayerCall = call;
            }
            registered = true;
            player.prepareAsync();
        } catch (Exception error) {
            if (registered) {
                finishAudioPlayback(player, "云端语音播放失败");
            } else {
                player.release();
                call.reject("云端语音播放失败", error);
            }
        }
    }

    @PluginMethod
    public void startRecognition(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "startAfterPermission");
            return;
        }
        startSession(call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("麦克风权限被拒绝");
            return;
        }
        startSession(call);
    }

    @PluginMethod
    public void stopRecognition(PluginCall call) {
        stopRecorder(false);
        call.resolve();
    }

    @PluginMethod
    public void cancelRecognition(PluginCall call) {
        finishSession(true);
        call.resolve();
    }

    @PluginMethod
    public void probeRecognition(PluginCall call) {
        String apiKey = call.getString("apiKey", "").trim();
        String url = call.getString("url", "").trim();
        String resourceId = call.getString("resourceId", "").trim();
        if (apiKey.isEmpty() || url.isEmpty() || resourceId.isEmpty()) {
            call.reject("云端语音配置不完整");
            return;
        }

        AtomicBoolean settled = new AtomicBoolean(false);
        Request request = new Request.Builder()
            .url(url)
            .header("X-Api-Key", apiKey)
            .header("X-Api-Resource-Id", resourceId)
            .header("X-Api-Request-Id", UUID.randomUUID().toString())
            .header("X-Api-Sequence", "-1")
            .header("X-Api-Connect-Id", UUID.randomUUID().toString())
            .build();
        WebSocket probeSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket socket, Response response) {
                if (!settled.compareAndSet(false, true)) return;
                socket.close(1000, "probe complete");
                call.resolve();
            }

            @Override
            public void onFailure(WebSocket socket, Throwable error, Response response) {
                if (!settled.compareAndSet(false, true)) return;
                int code = response == null ? 0 : response.code();
                String message = code == 401 || code == 403
                    ? "语音 API Key 无效或 ASR 服务未开通"
                    : "云端语音识别连接失败";
                call.reject(
                    message,
                    error instanceof Exception ? (Exception) error : new Exception(error)
                );
            }
        });
        mainHandler.postDelayed(() -> {
            if (!settled.compareAndSet(false, true)) return;
            probeSocket.cancel();
            call.reject("云端语音识别连接超时");
        }, 10_000);
    }

    @SuppressLint("MissingPermission")
    private void startSession(PluginCall call) {
        String apiKey = call.getString("apiKey", "").trim();
        String url = call.getString("url", "").trim();
        String resourceId = call.getString("resourceId", "").trim();
        if (apiKey.isEmpty() || url.isEmpty() || resourceId.isEmpty()) {
            call.reject("云端语音配置不完整");
            return;
        }

        synchronized (sessionLock) {
            if (!finished.get()) {
                call.reject("已有语音识别正在进行");
                return;
            }
            finished.set(false);
            startCall = call;
            resetMetrics();
        }

        Request request = new Request.Builder()
            .url(url)
            .header("X-Api-Key", apiKey)
            .header("X-Api-Resource-Id", resourceId)
            .header("X-Api-Request-Id", UUID.randomUUID().toString())
            .header("X-Api-Sequence", "-1")
            .header("X-Api-Connect-Id", UUID.randomUUID().toString())
            .build();

        webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket socket, Response response) {
                if (finished.get()) {
                    socket.close(1000, "cancelled");
                    return;
                }
                try {
                    socket.send(ByteString.of(buildFullRequest()));
                    startRecorder(socket);
                    PluginCall pending;
                    synchronized (sessionLock) {
                        pending = startCall;
                        startCall = null;
                    }
                    if (pending != null) pending.resolve();
                    notifyState("recording");
                } catch (Exception error) {
                    fail("无法启动云端语音识别", 0, error);
                }
            }

            @Override
            public void onMessage(WebSocket socket, ByteString bytes) {
                try {
                    parseServerFrame(bytes.toByteArray());
                } catch (Exception error) {
                    fail("无法解析云端语音结果", 0, error);
                }
            }

            @Override
            public void onFailure(WebSocket socket, Throwable error, Response response) {
                int code = response == null ? 0 : response.code();
                fail(code == 401 || code == 403
                    ? "语音 API Key 无效或服务未开通"
                    : "云端语音连接失败", code, error);
            }

            @Override
            public void onClosed(WebSocket socket, int code, String reason) {
                if (!finished.get()) finishSession(false);
            }
        });
    }

    @SuppressLint("MissingPermission")
    private void startRecorder(WebSocket socket) {
        int minimum = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        int chunkBytes = SAMPLE_RATE * 2 * CHUNK_MS / 1000;
        int bufferSize = Math.max(minimum, chunkBytes * 2);
        audioRecord = new AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            .setAudioFormat(new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build())
            .setBufferSizeInBytes(bufferSize)
            .build();
        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            throw new IllegalStateException("录音设备初始化失败");
        }

        int sessionId = audioRecord.getAudioSessionId();
        if (NoiseSuppressor.isAvailable()) {
            noiseSuppressor = NoiseSuppressor.create(sessionId);
        }
        if (AcousticEchoCanceler.isAvailable()) {
            echoCanceler = AcousticEchoCanceler.create(sessionId);
        }

        recording.set(true);
        recordingStartedAt = SystemClock.elapsedRealtime();
        audioRecord.startRecording();
        recordingThread = new Thread(() -> recordLoop(socket, chunkBytes), "sayable-cloud-asr");
        recordingThread.start();
    }

    private void recordLoop(WebSocket socket, int chunkBytes) {
        byte[] buffer = new byte[chunkBytes];
        try {
            while (recording.get() && !finished.get()) {
                int read = audioRecord.read(buffer, 0, buffer.length);
                if (read <= 0) continue;
                updateAudioMetrics(buffer, read);
                byte[] chunk = new byte[read];
                System.arraycopy(buffer, 0, chunk, 0, read);
                if (!socket.send(ByteString.of(buildAudioRequest(chunk, false)))) {
                    throw new IOException("语音数据发送失败");
                }
            }
            if (!finished.get()) {
                socket.send(ByteString.of(buildAudioRequest(new byte[0], true)));
                mainHandler.postDelayed(() -> {
                    if (!finished.get()) finishSession(false);
                }, 5_000);
            }
        } catch (Exception error) {
            if (!finished.get()) fail("录音过程中断", 0, error);
        } finally {
            releaseAudio();
        }
    }

    private void stopRecorder(boolean cancel) {
        recording.set(false);
        AudioRecord current = audioRecord;
        if (current != null) {
            try {
                current.stop();
            } catch (IllegalStateException ignored) {
                // The recording thread may already have stopped it.
            }
        }
        if (cancel) finishSession(true);
    }

    private void updateAudioMetrics(byte[] pcm, int length) {
        long squares = 0;
        int samples = length / 2;
        for (int offset = 0; offset + 1 < length; offset += 2) {
            int sample = (short) ((pcm[offset] & 0xff) | (pcm[offset + 1] << 8));
            squares += (long) sample * sample;
        }
        double rms = samples == 0 ? 0 : Math.sqrt((double) squares / samples);
        int duration = samples * 1000 / SAMPLE_RATE;
        if (rms >= 420) {
            if (heardVoice && consecutiveSilenceMs >= 600) longPauses += 1;
            consecutiveSilenceMs = 0;
            heardVoice = true;
            voicedMs += duration;
        } else if (heardVoice) {
            consecutiveSilenceMs += duration;
        }
    }

    private byte[] buildFullRequest() throws IOException, JSONException {
        JSONObject audio = new JSONObject()
            .put("format", "pcm")
            .put("codec", "raw")
            .put("rate", SAMPLE_RATE)
            .put("bits", 16)
            .put("channel", 1);
        JSONObject request = new JSONObject()
            .put("model_name", "bigmodel")
            .put("enable_nonstream", true)
            .put("enable_itn", true)
            .put("enable_punc", true)
            .put("enable_ddc", false)
            .put("show_utterances", true)
            .put("show_speech_rate", true)
            .put("show_volume", true)
            .put("result_type", "full")
            .put("end_window_size", 600);
        JSONObject payload = new JSONObject()
            .put("user", new JSONObject().put("uid", UUID.randomUUID().toString()))
            .put("audio", audio)
            .put("request", request);
        return frame(
            0x1,
            0x0,
            0x1,
            0x1,
            gzip(payload.toString().getBytes(StandardCharsets.UTF_8))
        );
    }

    private byte[] buildAudioRequest(byte[] audio, boolean last) throws IOException {
        return frame(0x2, last ? 0x2 : 0x0, 0x0, 0x1, gzip(audio));
    }

    private byte[] frame(
        int messageType,
        int flags,
        int serialization,
        int compression,
        byte[] payload
    ) {
        ByteBuffer output = ByteBuffer.allocate(8 + payload.length).order(ByteOrder.BIG_ENDIAN);
        output.put((byte) 0x11);
        output.put((byte) ((messageType << 4) | flags));
        output.put((byte) ((serialization << 4) | compression));
        output.put((byte) 0x00);
        output.putInt(payload.length);
        output.put(payload);
        return output.array();
    }

    private void parseServerFrame(byte[] data) throws IOException, JSONException {
        if (data.length < 8) throw new IOException("语音响应长度不足");
        int headerSize = (data[0] & 0x0f) * 4;
        int messageType = (data[1] >> 4) & 0x0f;
        int flags = data[1] & 0x0f;
        int compression = data[2] & 0x0f;
        int offset = headerSize;

        if (messageType == 0x0f) {
            if (data.length < offset + 8) throw new IOException("语音错误响应不完整");
            int errorCode = readInt(data, offset);
            offset += 4;
            int size = readInt(data, offset);
            offset += 4;
            byte[] payload = slice(data, offset, size);
            if (compression == 0x1) payload = gunzip(payload);
            fail(new String(payload, StandardCharsets.UTF_8), errorCode, null);
            return;
        }
        if (messageType != 0x09) return;

        int sequence = 0;
        if (flags == 0x1 || flags == 0x3) {
            sequence = readInt(data, offset);
            offset += 4;
        }
        int size = readInt(data, offset);
        offset += 4;
        byte[] payload = slice(data, offset, size);
        if (compression == 0x1) payload = gunzip(payload);
        JSONObject json = payload.length == 0
            ? new JSONObject()
            : new JSONObject(new String(payload, StandardCharsets.UTF_8));
        int code = json.has("code") ? json.optInt("code") : json.optInt("status_code");
        if (code != 0 && code != 1000 && code != SUCCESS_CODE) {
            fail(json.optString("message", "云端语音识别失败"), code, null);
            return;
        }

        boolean last = flags == 0x2 || flags == 0x3 || sequence < 0;
        emitResult(json, last);
        if (last) finishSession(false);
    }

    private void emitResult(JSONObject payload, boolean lastFrame) throws JSONException {
        JSONObject result = payload.optJSONObject("result");
        if (result == null) return;
        JSONArray utterances = result.optJSONArray("utterances");
        JSArray words = new JSArray();
        String text = result.optString("text", "");
        StringBuilder joined = new StringBuilder();
        boolean sawUtterance = false;
        boolean allUtterancesDefinite = true;
        double speechRate = 0;
        double confidenceTotal = 0;
        int confidenceCount = 0;

        if (result.has("confidence")) {
            confidenceTotal = result.optDouble("confidence", 0);
            confidenceCount = 1;
        }

        if (utterances != null) {
            for (int index = 0; index < utterances.length(); index++) {
                JSONObject utterance = utterances.optJSONObject(index);
                if (utterance == null) continue;
                sawUtterance = true;
                if (joined.length() > 0) joined.append(' ');
                joined.append(utterance.optString("text", ""));
                allUtterancesDefinite = allUtterancesDefinite
                    && utterance.optBoolean("definite", false);
                if (speechRate == 0) speechRate = utterance.optDouble("speech_rate", 0);
                if (confidenceCount == 0 && utterance.has("confidence")) {
                    confidenceTotal += utterance.optDouble("confidence", 0);
                    confidenceCount += 1;
                }
                JSONArray sourceWords = utterance.optJSONArray("words");
                if (sourceWords == null) continue;
                for (int wordIndex = 0; wordIndex < sourceWords.length(); wordIndex++) {
                    JSONObject sourceWord = sourceWords.optJSONObject(wordIndex);
                    if (sourceWord == null) continue;
                    JSObject word = new JSObject();
                    word.put("text", sourceWord.optString(
                        "text",
                        sourceWord.optString("word", "")
                    ));
                    word.put("startMs", sourceWord.optLong("start_time", 0));
                    word.put("endMs", sourceWord.optLong("end_time", 0));
                    if (sourceWord.has("confidence")) {
                        word.put("confidence", sourceWord.optDouble("confidence", 0));
                    }
                    words.put(word);
                }
            }
        }
        if (text.isEmpty()) text = joined.toString().trim();
        if (text.isEmpty()) return;

        JSObject event = new JSObject();
        event.put("text", text);
        event.put("final", lastFrame || (sawUtterance && allUtterancesDefinite));
        event.put("words", words);
        event.put("durationMs", Math.max(
            1,
            SystemClock.elapsedRealtime() - recordingStartedAt
        ));
        event.put("voicedMs", voicedMs);
        event.put("longPauses", longPauses);
        if (confidenceCount > 0) {
            event.put("confidence", confidenceTotal / confidenceCount);
        }
        if (speechRate > 0) event.put("speechRate", speechRate);
        notifyListeners("speechResult", event);
    }

    private void fail(String message, int code, Throwable error) {
        if (!finished.compareAndSet(false, true)) return;
        recording.set(false);
        releaseAudio();
        WebSocket socket = webSocket;
        webSocket = null;
        if (socket != null) socket.cancel();

        PluginCall pending;
        synchronized (sessionLock) {
            pending = startCall;
            startCall = null;
        }
        String safeMessage = message == null || message.isBlank()
            ? "云端语音识别失败"
            : message;
        if (pending != null) {
            if (error == null) pending.reject(safeMessage);
            else pending.reject(
                safeMessage,
                error instanceof Exception ? (Exception) error : new Exception(error)
            );
            return;
        }
        JSObject event = new JSObject();
        event.put("message", safeMessage);
        event.put("code", code);
        notifyListeners("speechError", event);
    }

    private void finishSession(boolean cancel) {
        if (!finished.compareAndSet(false, true)) return;
        recording.set(false);
        releaseAudio();
        WebSocket socket = webSocket;
        webSocket = null;
        if (socket != null) {
            if (cancel) socket.cancel();
            else socket.close(1000, "finished");
        }
        synchronized (sessionLock) {
            if (startCall != null) {
                startCall.reject("语音识别已取消");
                startCall = null;
            }
        }
        notifyState("finished");
    }

    private void notifyState(String value) {
        JSObject event = new JSObject();
        event.put("state", value);
        notifyListeners("speechState", event);
    }

    private void releaseAudio() {
        AudioRecord current = audioRecord;
        audioRecord = null;
        if (current != null) {
            try {
                current.stop();
            } catch (IllegalStateException ignored) {
                // Already stopped.
            }
            current.release();
        }
        if (noiseSuppressor != null) {
            noiseSuppressor.release();
            noiseSuppressor = null;
        }
        if (echoCanceler != null) {
            echoCanceler.release();
            echoCanceler = null;
        }
    }

    private void resetMetrics() {
        recordingStartedAt = 0;
        voicedMs = 0;
        longPauses = 0;
        consecutiveSilenceMs = 0;
        heardVoice = false;
    }

    private void stopAudioPlayback() {
        MediaPlayer player;
        PluginCall call;
        synchronized (playerLock) {
            player = mediaPlayer;
            call = mediaPlayerCall;
            mediaPlayer = null;
            mediaPlayerCall = null;
        }
        if (player != null) player.release();
        if (call != null) call.resolve();
    }

    private void finishAudioPlayback(MediaPlayer player, String error) {
        PluginCall call;
        synchronized (playerLock) {
            if (mediaPlayer != player) return;
            mediaPlayer = null;
            call = mediaPlayerCall;
            mediaPlayerCall = null;
        }
        player.release();
        if (call == null) return;
        if (error == null) call.resolve();
        else call.reject(error);
    }

    private static int readInt(byte[] source, int offset) throws IOException {
        if (offset < 0 || source.length < offset + 4) throw new IOException("语音响应越界");
        return ByteBuffer.wrap(source, offset, 4).order(ByteOrder.BIG_ENDIAN).getInt();
    }

    private static byte[] slice(byte[] source, int offset, int size) throws IOException {
        if (size < 0 || offset < 0 || source.length < offset + size) {
            throw new IOException("语音响应负载不完整");
        }
        byte[] output = new byte[size];
        System.arraycopy(source, offset, output, 0, size);
        return output;
    }

    private static byte[] gzip(byte[] input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(output)) {
            gzip.write(input);
        }
        return output.toByteArray();
    }

    private static byte[] gunzip(byte[] input) throws IOException {
        try (
            GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(input));
            ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = gzip.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    @Override
    protected void handleOnDestroy() {
        finishSession(true);
        stopAudioPlayback();
        httpClient.dispatcher().executorService().shutdown();
        super.handleOnDestroy();
    }
}
