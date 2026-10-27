package it.filippo.biostv;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
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
        cache = out;
        return out;
    }

    static String toJson(Context c, boolean images, boolean refresh) {
        JSONArray arr = new JSONArray();
        for (App a : get(c, refresh)) {
            try {
                JSONObject o = new JSONObject();
                o.put("pkg", a.pkg);
                o.put("label", a.label);
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
