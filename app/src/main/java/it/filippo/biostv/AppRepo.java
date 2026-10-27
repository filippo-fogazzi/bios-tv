package it.filippo.biostv;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Installed TV apps with their 16:9 banners, encoded once and cached in memory. */
final class AppRepo {
    static final class App {
        String pkg, label, banner, icon;
        boolean input;
        String inputId;
    }

    private static List<App> cache;

    private AppRepo() {}

    static synchronized void invalidate() { cache = null; }

    static synchronized List<App> get(Context c, boolean refresh) {
        if (cache != null && !refresh) return cache;
        PackageManager pm = c.getPackageManager();
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        List<ResolveInfo> found = pm.queryIntentActivities(i, 0);
        List<App> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (ResolveInfo ri : found) {
            ActivityInfo ai = ri.activityInfo;
            if (ai == null || ai.packageName.equals(c.getPackageName()) || !seen.add(ai.packageName)) continue;
            App a = new App();
            a.pkg = ai.packageName;
            a.label = String.valueOf(ri.loadLabel(pm));
            try {
                Drawable b = ai.loadBanner(pm);
                if (b == null) b = ai.applicationInfo.loadBanner(pm);
                if (b != null) a.banner = encode(b, 320, 180, true);
                else a.icon = encode(ri.loadIcon(pm), 128, 128, false);
            } catch (Throwable t) {
                // A broken drawable shouldn't hide the app: the UI shows its name instead.
            }
            out.add(a);
        }
        Collections.sort(out, (x, y) -> x.label.compareToIgnoreCase(y.label));
        out.addAll(0, inputs(c));
        cache = out;
        return out;
    }

    /**
     * HDMI inputs (PS5, decoder…) as launchable tiles. Only TVs with Google TV built in have them;
     * a dongle returns none. CEC devices appear as children of their port: prefer those names.
     */
    private static List<App> inputs(Context c) {
        List<App> res = new ArrayList<>();
        try {
            TvInputManager tim = (TvInputManager) c.getSystemService(Context.TV_INPUT_SERVICE);
            if (tim == null) return res;
            List<TvInputInfo> all = tim.getTvInputList();
            Set<String> parentsWithChild = new HashSet<>();
            for (TvInputInfo i : all) if (i.getParentId() != null) parentsWithChild.add(i.getParentId());
            for (TvInputInfo i : all) {
                if (i.getType() != TvInputInfo.TYPE_HDMI || i.isHidden(c) || parentsWithChild.contains(i.getId())) continue;
                // Only ports with something plugged in (a console in rest mode still counts).
                boolean cecDevice = i.getParentId() != null;
                if (!cecDevice && tim.getInputState(i.getId()) == TvInputManager.INPUT_STATE_DISCONNECTED) continue;
                CharSequence label = i.loadCustomLabel(c);
                if (label == null || label.length() == 0) label = i.loadLabel(c);
                App a = new App();
                a.input = true;
                a.inputId = i.getId();
                a.pkg = "input:" + i.getId();
                a.label = label == null ? "HDMI" : label.toString().trim();
                // Bare ports ("HDMI 1", "HDMI 2") are noise: keep only named devices such as the PS5.
                if (!cecDevice && a.label.matches("(?i)^(hdmi|ingresso|input)\\s*\\d*(\\s*\\(.*\\))?$")) continue;
                res.add(a);
            }
        } catch (Throwable t) {
            // No TV input framework on this device.
        }
        return res;
    }

    static String inputIdFor(String pkg) {
        return pkg != null && pkg.startsWith("input:") ? pkg.substring(6) : null;
    }

    static android.net.Uri inputUri(String inputId) {
        return TvContract.buildChannelUriForPassthroughInput(inputId);
    }

    private static final String CACHE_FILE = "apps-cache.json";

    /** Last app list written to disk: lets the launcher paint its tiles before the slow scan. */
    static String cachedJson(Context c) {
        java.io.File f = new java.io.File(c.getFilesDir(), CACHE_FILE);
        if (!f.exists()) return null;
        try (java.io.InputStream in = new java.io.FileInputStream(f)) { return Store.readAll(in); }
        catch (Exception e) { return null; }
    }

    static void writeCache(Context c, String json) {
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(c.getFilesDir(), CACHE_FILE))) {
            out.write(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
    }

    static String toJson(Context c, boolean images, boolean refresh) {
        JSONArray arr = new JSONArray();
        for (App a : get(c, refresh)) {
            try {
                JSONObject o = new JSONObject();
                o.put("pkg", a.pkg);
                o.put("label", a.label);
                if (a.input) o.put("input", true);
                if (images) {
                    if (a.banner != null) o.put("banner", a.banner);
                    if (a.icon != null) o.put("icon", a.icon);
                }
                arr.put(o);
            } catch (Exception ignored) {
            }
        }
        return arr.toString();
    }

    private static String encode(Drawable d, int w, int h, boolean jpeg) {
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        if (jpeg) cv.drawColor(0xFF16181A);
        d.setBounds(0, 0, w, h);
        d.draw(cv);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bmp.compress(jpeg ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG, 90, bo);
        bmp.recycle();
        return (jpeg ? "data:image/jpeg;base64," : "data:image/png;base64,")
                + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
    }
}
