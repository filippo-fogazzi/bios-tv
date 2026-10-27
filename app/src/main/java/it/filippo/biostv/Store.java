package it.filippo.biostv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/** Your life data: one JSON file on the TV, shared by the launcher and the phone page. */
final class Store {
    private static final Object LOCK = new Object();
    private static final String FILE = "data.json";

    private Store() {}

    static String read(Context c) {
        synchronized (LOCK) {
            File f = new File(c.getFilesDir(), FILE);
            try {
                if (f.exists()) {
                    try (InputStream in = new FileInputStream(f)) { return readAll(in); }
                }
                try (InputStream in = c.getAssets().open("www/default-data.json")) { return readAll(in); }
            } catch (IOException e) {
                return "{}";
            }
        }
    }

    /** Validates and atomically replaces the data file. */
    static boolean write(Context c, String json) {
        try {
            new JSONObject(json);
        } catch (Exception e) {
            return false;
        }
        synchronized (LOCK) {
            File dir = c.getFilesDir();
            File tmp = new File(dir, FILE + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            } catch (IOException e) {
                return false;
            }
            return tmp.renameTo(new File(dir, FILE));
        }
    }

    /** 4-digit PIN that protects the phone page, created once. */
    static String pin(Context c) {
        SharedPreferences p = c.getSharedPreferences("biostv", Context.MODE_PRIVATE);
        String pin = p.getString("pin", null);
        if (pin == null) {
            pin = String.valueOf(1000 + new SecureRandom().nextInt(9000));
            p.edit().putString("pin", pin).apply();
        }
        return pin;
    }

    static String readAll(InputStream in) throws IOException {
        return new String(readBytes(in), StandardCharsets.UTF_8);
    }

    static byte[] readBytes(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }
}
