package it.filippo.biostv;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Google TV won't let a third-party app become the real Home. This service watches for the
 * stock launcher coming to the front (Home button, wake from standby) and brings BIOS back.
 * It only listens to window changes of the stock launchers and reads no screen content.
 */
public class HomeWatcherService extends AccessibilityService {
    static final Set<String> STOCK = new HashSet<>(Arrays.asList(
            "com.google.android.apps.tv.launcherx",
            "com.google.android.tvlauncher",
            "com.google.android.leanbacklauncher"));

    /** "Apri Home di Google TV" pauses the redirect so the stock home stays usable. */
    static volatile long pausedUntil = 0;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkg = e.getPackageName();
        if (pkg == null || !STOCK.contains(pkg.toString())) return;
        if (System.currentTimeMillis() < pausedUntil) return;
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(i);
    }

    @Override
    protected void onServiceConnected() {
        // After a self-update the system re-binds this service: a reliable moment to reopen BIOS.
        Updater.reopenIfJustUpdated(this);
    }

    @Override
    public void onInterrupt() {}

    /**
     * Re-enables this service by itself. Works only if the permission WRITE_SECURE_SETTINGS was
     * granted once via ADB; that grant survives app updates, so Home keeps working after each one.
     */
    static boolean tryEnable(Context c) {
        if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return false;
        try {
            android.content.ContentResolver cr = c.getContentResolver();
            String me = new ComponentName(c, HomeWatcherService.class).flattenToString();
            String cur = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            String next = cur == null || cur.isEmpty() ? me : (cur.contains(me) ? cur : cur + ":" + me);
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, next);
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static boolean isEnabled(Context c) {
        String on = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (on == null) return false;
        ComponentName me = new ComponentName(c, HomeWatcherService.class);
        for (String s : on.split(":")) {
            ComponentName cn = ComponentName.unflattenFromString(s);
            if (me.equals(cn)) return true;
        }
        return false;
    }
}
