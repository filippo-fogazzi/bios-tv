package it.filippo.biostv;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Self-update from the GitHub releases of this repository. Every CI build is published as
 * "build-N" with versionCode N; when a higher N exists, the APK is streamed into a
 * PackageInstaller session. Android then asks the user for one confirmation.
 */
final class Updater {
    static final String RELEASES = "https://api.github.com/repos/filippo-fogazzi/bios-tv/releases/latest";
    static final String ACTION_STATUS = "it.filippo.biostv.INSTALL_STATUS";

    static final class Release {
        int build;
        String apkUrl;
    }

    private Updater() {}

    static int currentBuild(Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Returns the latest release if it is newer than the installed build, otherwise null. */
    static Release check(Context c) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(RELEASES).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(10000);
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("User-Agent", "BiosTV-Updater");
        try {
            if (conn.getResponseCode() != 200) return null;
            JSONObject o;
            try (InputStream in = conn.getInputStream()) { o = new JSONObject(Store.readAll(in)); }
            String tag = o.optString("tag_name");
            if (!tag.startsWith("build-")) return null;
            int build = Integer.parseInt(tag.substring(6));
            if (build <= currentBuild(c)) return null;
            JSONArray assets = o.optJSONArray("assets");
            if (assets == null) return null;
            for (int i = 0; i < assets.length(); i++) {
                JSONObject a = assets.optJSONObject(i);
                if (a != null && a.optString("name").endsWith(".apk")) {
                    Release r = new Release();
                    r.build = build;
                    r.apkUrl = a.optString("browser_download_url");
                    return r;
                }
            }
            return null;
        } finally {
            conn.disconnect();
        }
    }

    /** Streams the APK into an install session and commits it; the result arrives as a broadcast. */
    static void install(Context c, Release r) throws Exception {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        int id = pi.createSession(params);
        PackageInstaller.Session session = pi.openSession(id);
        HttpURLConnection conn = (HttpURLConnection) new URL(r.apkUrl).openConnection();
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("User-Agent", "BiosTV-Updater");
        try (InputStream in = conn.getInputStream(); OutputStream out = session.openWrite("bios-tv.apk", 0, -1)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            session.fsync(out);
        } catch (Exception e) {
            session.abandon();
            throw e;
        } finally {
            conn.disconnect();
        }
        Intent status = new Intent(ACTION_STATUS).setPackage(c.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pending = PendingIntent.getBroadcast(c, id, status, flags);
        session.commit(pending.getIntentSender());
        session.close();
    }
}
