package it.filippo.biostv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.ComponentName;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The launcher: a full-screen WebView running assets/www, plus the native pieces it needs. */
public class MainActivity extends Activity {
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private volatile String pendingSpeech;               // greeting asked before the voice engine was ready
    private boolean okLongFired;
    private final ExecutorService io = Executors.newFixedThreadPool(2);

    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { js("window.app&&app.onWake()"); }
    };
    private volatile Updater.Release pendingUpdate;

    /** Result of an update install: Android needs the user's confirmation, or reports a failure. */
    private final BroadcastReceiver installStatus = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) safeStart(confirm);
            } else if (st != PackageInstaller.STATUS_SUCCESS) {
                String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                js("window.app&&app.updateFailed(" + JSONObject.quote(msg == null ? "" : msg) + ")");
            }
        }
    };
    private final BroadcastReceiver packages = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            AppRepo.invalidate();
            js("window.app&&app.refreshApps()");
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(9, 10, 11));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.setFocusable(false);                         // keys go through dispatchKeyEvent → JS
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");

        initTts();
        LifeServer.ensure(this, () -> js("window.app&&app.onData()"));

        IntentFilter pf = new IntentFilter();
        pf.addAction(Intent.ACTION_PACKAGE_ADDED);
        pf.addAction(Intent.ACTION_PACKAGE_REMOVED);
        pf.addAction(Intent.ACTION_PACKAGE_CHANGED);
        pf.addDataScheme("package");
        register(packages, pf);
        register(screenOn, new IntentFilter(Intent.ACTION_SCREEN_ON));
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installStatus, new IntentFilter(Updater.ACTION_STATUS), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installStatus, new IntentFilter(Updater.ACTION_STATUS));
    }

    private void register(BroadcastReceiver r, IntentFilter f) {
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(r, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(r, f);
    }

    private void initTts() {
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setLanguage(Locale.ITALY);
            // Prefer the best Italian voice that works offline.
            try {
                Voice best = null;
                for (Voice v : tts.getVoices()) {
                    if (!"it".equals(v.getLocale().getLanguage()) || v.isNetworkConnectionRequired()) continue;
                    if (best == null || v.getQuality() > best.getQuality()) best = v;
                }
                if (best != null) tts.setVoice(best);
            } catch (Exception ignored) {
            }
            tts.setSpeechRate(0.97f);
            tts.setPitch(0.94f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { js("window.app&&app.ttsState('start')"); }
                @Override public void onDone(String id) { js("window.app&&app.ttsState('done')"); }
                @Override public void onError(String id) { js("window.app&&app.ttsState('done')"); }
            });
            ttsReady = true;
            if (pendingSpeech != null) { speakNow(pendingSpeech); pendingSpeech = null; }
        });
    }

    private void speakNow(String text) {
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bios-" + System.currentTimeMillis());
    }

    void js(String code) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    /* ---------------------------------------------------------------- remote control */

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN, up = e.getAction() == KeyEvent.ACTION_UP;
        switch (k) {
            case KeyEvent.KEYCODE_DPAD_UP: if (down) key("up"); return true;
            case KeyEvent.KEYCODE_DPAD_DOWN: if (down) key("down"); return true;
            case KeyEvent.KEYCODE_DPAD_LEFT: if (down) key("left"); return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT: if (down) key("right"); return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                if (down) {
                    if (e.getRepeatCount() == 0) okLongFired = false;
                    else if (!okLongFired && e.getEventTime() - e.getDownTime() > 600) { okLongFired = true; key("hold"); }
                } else if (up && !okLongFired) {
                    // Remotes that send no key repeats: judge the press by its duration.
                    key(e.getEventTime() - e.getDownTime() > 600 ? "hold" : "ok");
                }
                return true;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                if (up) key("back");
                return true;
            case KeyEvent.KEYCODE_MENU:
                if (up) key("menu");
                return true;
            default:
                return super.dispatchKeyEvent(e);
        }
    }

    private void key(String name) { js("window.app&&app.key('" + name + "')"); }

    @Override
    protected void onResume() {
        super.onResume();
        js("window.app&&app.onResume()");
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (tts != null) tts.stop();
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(packages); unregisterReceiver(screenOn); unregisterReceiver(installStatus); } catch (Exception ignored) {}
        if (tts != null) tts.shutdown();
        if (web != null) { web.destroy(); web = null; }
        io.shutdown();
        super.onDestroy();
    }

    private void openStockHome() {
        HomeWatcherService.pausedUntil = System.currentTimeMillis() + 10 * 60 * 1000;
        for (String pkg : HomeWatcherService.STOCK) {
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(pkg)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (i.resolveActivity(getPackageManager()) != null) {
                startActivity(i);
                return;
            }
        }
    }

    private boolean safeStart(Intent i) {
        try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true; } catch (Exception e) { return false; }
    }

    /** Accessibility settings live in different places on different TV builds: try them in order. */
    private boolean openAccessibilitySettings() {
        Intent[] tries = {
            new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
            new Intent().setComponent(new ComponentName("com.android.tv.settings", "com.android.tv.settings.accessibility.AccessibilityActivity")),
            new Intent().setComponent(new ComponentName("com.android.tv.settings", "com.android.tv.settings.system.AccessibilityActivity")),
            new Intent().setComponent(new ComponentName("com.google.android.tv.settings", "com.android.tv.settings.accessibility.AccessibilityActivity")),
        };
        for (Intent t : tries) if (safeStart(t)) return true;
        return false;
    }

    /* ---------------------------------------------------------------- JS bridge */

    final class Bridge {
        @JavascriptInterface public String getData() { return Store.read(MainActivity.this); }

        @JavascriptInterface public void saveData(String json) { Store.write(MainActivity.this, json); }

        @JavascriptInterface public void requestApps(boolean refresh) {
            io.execute(() -> {
                String cached = refresh ? null : AppRepo.cachedJson(MainActivity.this);
                if (cached != null) js("window.app&&app._apps(" + cached + ")");
                String fresh = AppRepo.toJson(MainActivity.this, true, refresh);
                if (!fresh.equals(cached)) {
                    AppRepo.writeCache(MainActivity.this, fresh);
                    js("window.app&&app._apps(" + fresh + ")");
                }
            });
        }

        @JavascriptInterface public void launch(String pkg) {
            String inputId = AppRepo.inputIdFor(pkg);
            if (inputId != null) {                        // HDMI: hand over to the TV's own input viewer
                safeStart(new Intent(Intent.ACTION_VIEW, AppRepo.inputUri(inputId)));
                return;
            }
            Intent i = getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = getPackageManager().getLaunchIntentForPackage(pkg);
            if (i != null) safeStart(i);
        }

        @JavascriptInterface public void speak(String text) {
            if (!ttsReady) { pendingSpeech = text; return; }
            speakNow(text);
        }

        @JavascriptInterface public void stopSpeak() { if (tts != null) tts.stop(); }

        /** Keeps the screen on during a study session; the system screensaver can't interrupt it. */
        @JavascriptInterface public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface public void httpGet(String id, String url) {
            io.execute(() -> {
                boolean ok = false;
                String body;
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(10000);
                    c.setRequestProperty("User-Agent", "BiosTV/1.0");
                    int code = c.getResponseCode();
                    InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                    body = in == null ? "" : read(in);
                    ok = code < 400;
                } catch (Exception e) {
                    body = String.valueOf(e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
                js("window.app&&app._http(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(body) + ")");
            });
        }

        @JavascriptInterface public void httpPost(String id, String url, String headersJson, String body) {
            io.execute(() -> {
                boolean ok = false;
                String res;
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(12000);
                    c.setRequestMethod("POST");
                    c.setDoOutput(true);
                    c.setRequestProperty("User-Agent", "BiosTV/1.0");
                    JSONObject h = new JSONObject(headersJson == null ? "{}" : headersJson);
                    java.util.Iterator<String> keys = h.keys();
                    while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, h.optString(k)); }
                    byte[] out = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
                    c.setFixedLengthStreamingMode(out.length);
                    try (java.io.OutputStream os = c.getOutputStream()) { os.write(out); }
                    int code = c.getResponseCode();
                    InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                    res = in == null ? "" : read(in);
                    ok = code < 400;
                    if (!ok) res = code + " " + res;
                } catch (Exception e) {
                    res = String.valueOf(e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
                js("window.app&&app._http(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(res) + ")");
            });
        }

        @JavascriptInterface public String getServerInfo() { return LifeServer.info(MainActivity.this); }

        @JavascriptInterface public boolean isHomeWatcherOn() { return HomeWatcherService.isEnabled(MainActivity.this); }

        /** True if an accessibility screen opened; false means the general settings opened instead. */
        @JavascriptInterface public boolean openAccessibility() {
            if (openAccessibilitySettings()) return true;
            safeStart(new Intent(Settings.ACTION_SETTINGS));
            return false;
        }

        @JavascriptInterface public int currentBuild() { return Updater.currentBuild(MainActivity.this); }

        @JavascriptInterface public void checkUpdate() {
            io.execute(() -> {
                try {
                    Updater.Release r = Updater.check(MainActivity.this);
                    pendingUpdate = r;
                    if (r != null) js("window.app&&app.updateAvailable(" + r.build + ")");
                } catch (Exception ignored) {
                    // offline or GitHub unreachable: try again later
                }
            });
        }

        @JavascriptInterface public void installUpdate() {
            Updater.Release r = pendingUpdate;
            if (r == null) return;
            io.execute(() -> {
                try {
                    Updater.install(MainActivity.this, r);
                } catch (Exception e) {
                    js("window.app&&app.updateFailed(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
                }
            });
        }

        @JavascriptInterface public void openSystemSettings() { safeStart(new Intent(Settings.ACTION_SETTINGS)); }

        @JavascriptInterface public void openStockHome() { runOnUiThread(MainActivity.this::openStockHome); }
    }

    private static String read(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }
}
