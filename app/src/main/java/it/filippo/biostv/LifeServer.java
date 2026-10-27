package it.filippo.biostv;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tiny HTTP server on the home network (port 8765) so the phone can edit agenda,
 * training and settings. Everything except the page itself requires the PIN shown on the TV.
 */
final class LifeServer extends Thread {
    static final int PORT = 8765;
    private static final String TAG = "BiosTV";
    private static final int MAX_BODY = 512 * 1024;

    interface Listener { void onDataChanged(); }

    private static LifeServer instance;
    private final Context ctx;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private volatile Listener listener;
    private int badPins = 0;

    private LifeServer(Context c) {
        super("LifeServer");
        ctx = c.getApplicationContext();
        setDaemon(true);
    }

    static synchronized void ensure(Context c, Listener l) {
        if (instance == null) {
            instance = new LifeServer(c);
            instance.start();
        }
        instance.listener = l;
    }

    @Override
    public void run() {
        try (ServerSocket ss = new ServerSocket()) {
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(PORT));
            while (!isInterrupted()) {
                final Socket s = ss.accept();
                pool.execute(() -> handle(s));
            }
        } catch (IOException e) {
            Log.w(TAG, "server stopped", e);
        }
    }

    private void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(10000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            String request = readLine(in);
            if (request == null) return;
            String[] parts = request.split(" ");
            if (parts.length < 2) return;
            String method = parts[0], path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0) headers.put(line.substring(0, c).trim().toLowerCase(Locale.ROOT), line.substring(c + 1).trim());
            }
            int len = 0;
            try { len = Integer.parseInt(headers.getOrDefault("content-length", "0")); } catch (NumberFormatException ignored) {}
            if (len < 0 || len > MAX_BODY) { send(out, 413, "text/plain", bytes("too large")); return; }
            byte[] body = new byte[len];
            int read = 0;
            while (read < len) {
                int n = in.read(body, read, len - read);
                if (n < 0) break;
                read += n;
            }
            route(method, path, headers, body, out);
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        }
    }

    private void route(String method, String path, Map<String, String> h, byte[] body, OutputStream out) throws IOException {
        if ("GET".equals(method) && ("/".equals(path) || "/index.html".equals(path))) {
            send(out, 200, "text/html; charset=utf-8", asset("phone/index.html"));
            return;
        }
        if ("GET".equals(method) && path.startsWith("/fonts/") && !path.contains("..")) {
            byte[] f = asset("www" + path);
            if (f == null) send(out, 404, "text/plain", bytes("not found"));
            else send(out, 200, path.endsWith(".ttf") ? "font/ttf" : "font/otf", f);
            return;
        }
        if ("/api/ping".equals(path)) {
            send(out, 200, "application/json", bytes("{\"ok\":true}"));
            return;
        }
        if (!checkPin(h.get("x-pin"))) {
            send(out, 401, "application/json", bytes("{\"error\":\"pin\"}"));
            return;
        }
        switch (method + " " + path) {
            case "GET /api/data":
                send(out, 200, "application/json; charset=utf-8", bytes(Store.read(ctx)));
                break;
            case "POST /api/data":
                if (Store.write(ctx, new String(body, StandardCharsets.UTF_8))) {
                    Listener l = listener;
                    if (l != null) l.onDataChanged();
                    send(out, 200, "application/json", bytes("{\"ok\":true}"));
                } else {
                    send(out, 400, "application/json", bytes("{\"error\":\"json\"}"));
                }
                break;
            case "GET /api/apps":
                send(out, 200, "application/json; charset=utf-8", bytes(AppRepo.toJson(ctx, false, false)));
                break;
            default:
                send(out, 404, "text/plain", bytes("not found"));
        }
    }

    /** Slows down guessing: after repeated wrong PINs every attempt waits a little longer. */
    private boolean checkPin(String given) {
        boolean ok = Store.pin(ctx).equals(given);
        int bad;
        synchronized (this) {
            if (ok) { badPins = 0; return true; }
            bad = ++badPins;
        }
        if (bad > 5) {
            try { Thread.sleep(Math.min(10000, 500L * bad)); } catch (InterruptedException ignored) {}
        }
        return false;
    }

    private byte[] asset(String name) {
        try (InputStream in = ctx.getAssets().open(name)) {
            return Store.readBytes(in);
        } catch (IOException e) {
            return null;
        }
    }

    private static byte[] bytes(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    private static void send(OutputStream out, int code, String type, byte[] body) throws IOException {
        if (body == null) { code = 404; type = "text/plain"; body = bytes("not found"); }
        String status = code == 200 ? "OK" : code == 401 ? "Unauthorized" : code == 404 ? "Not Found" : "Error";
        String head = "HTTP/1.1 " + code + " " + status + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) throw new IOException("header too long");
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("ISO-8859-1");
    }

    /** Address to show on screen, e.g. http://192.168.1.42:8765 */
    static String url() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        return "http://" + a.getHostAddress() + ":" + PORT;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    static String info(Context c) {
        try {
            JSONObject o = new JSONObject();
            String u = url();
            if (u != null) o.put("url", u);
            o.put("pin", Store.pin(c));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
