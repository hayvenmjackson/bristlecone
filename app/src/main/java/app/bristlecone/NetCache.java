package app.bristlecone;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Local-first network layer. Every GET the map makes passes through here, so tiles, trail
 * data and reports are stored on the phone and keep working with no signal. Also serves the
 * bundled web UI from a private https origin.
 */
public final class NetCache {
    public static final String APP_HOST = "app.bristlecone.local";
    public static final String USER_AGENT = "Bristlecone/1.0 (Android trail map; public-data client)";
    private static final long BROWSE_CACHE_CAP = 700L * 1024 * 1024;

    private final Context ctx;
    private final File dir;
    private final AssetManager assets;
    private volatile Set<String> pinned = new HashSet<>();

    public NetCache(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.dir = new File(ctx.getFilesDir(), "cache");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        this.assets = ctx.getAssets();
    }

    public File dir() { return dir; }

    public void setPinned(Set<String> keys) { pinned = keys; }

    public boolean isOnline() {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    // ------------------------------------------------------------------ WebView entry point

    public WebResourceResponse intercept(WebResourceRequest req) {
        String url = req.getUrl().toString();
        String host = req.getUrl().getHost();
        if (APP_HOST.equals(host)) return serveAsset(req.getUrl().getPath());
        if (!"GET".equalsIgnoreCase(req.getMethod())) return null;
        String scheme = req.getUrl().getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
        Result r = get(url, false);
        return toResponse(r);
    }

    private WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return notFound();
        try {
            InputStream in = assets.open("web" + path);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime(path), mime(path).startsWith("text") || path.endsWith(".js") || path.endsWith(".json") ? "utf-8" : null, 200, "OK", h, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
    }

    // ------------------------------------------------------------------ Core fetch

    public static final class Result {
        public int status;
        public String contentType = "application/octet-stream";
        public byte[] body = new byte[0];
        public long fetchedAt;
        public boolean stale;
        public boolean fromCache;
    }

    /** Fetch with the cache policy for this URL. forceNetwork is used by the region downloader. */
    public Result get(String url, boolean forceNetwork) {
        CachePolicy.Kind kind = CachePolicy.classify(url);
        String key = CachePolicy.key(url);
        File body = new File(dir, key + ".bin");
        File meta = new File(dir, key + ".meta");
        Result cached = readCached(body, meta);
        long now = System.currentTimeMillis();
        if (!forceNetwork && cached != null && now - cached.fetchedAt < CachePolicy.ttl(kind)) {
            //noinspection ResultOfMethodCallIgnored
            body.setLastModified(now);
            return cached;
        }
        if (!isOnline() && cached != null) {
            cached.stale = true;
            return cached;
        }
        try {
            Result fresh = fetch(url, kind);
            boolean cacheable = fresh.status == 200 || (kind == CachePolicy.Kind.TILE && (fresh.status == 204 || fresh.status == 404));
            if (cacheable) write(body, meta, url, fresh);
            else if (cached != null) { cached.stale = true; return cached; }
            return fresh;
        } catch (IOException e) {
            if (cached != null) { cached.stale = true; return cached; }
            Result err = new Result();
            err.status = 504;
            err.contentType = "text/plain";
            err.body = ("offline: " + e.getClass().getSimpleName()).getBytes();
            return err;
        }
    }

    public boolean isCachedFresh(String url) {
        String key = CachePolicy.key(url);
        File meta = new File(dir, key + ".meta");
        if (!meta.exists()) return false;
        Result r = readCached(new File(dir, key + ".bin"), meta);
        return r != null && System.currentTimeMillis() - r.fetchedAt < CachePolicy.ttl(CachePolicy.classify(url));
    }

    private Result fetch(String url, CachePolicy.Kind kind) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(9000);
        c.setReadTimeout(url.contains("overpass") ? 95000 : 25000);
        c.setRequestProperty("User-Agent", USER_AGENT);
        c.setRequestProperty("Accept", "*/*");
        if (url.contains("api.weather.gov")) c.setRequestProperty("Accept", "application/geo+json");
        c.setInstanceFollowRedirects(true);
        try {
            int code = c.getResponseCode();
            Result r = new Result();
            r.status = code;
            String ct = c.getContentType();
            if (ct != null) r.contentType = ct;
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            r.body = in == null ? new byte[0] : readAll(in);
            r.fetchedAt = System.currentTimeMillis();
            return r;
        } finally {
            c.disconnect();
        }
    }

    // ------------------------------------------------------------------ Disk

    private Result readCached(File body, File meta) {
        if (!body.exists() || !meta.exists()) return null;
        try {
            JSONObject m = new JSONObject(new String(readAll(new FileInputStream(meta)), "UTF-8"));
            Result r = new Result();
            r.status = m.optInt("status", 200);
            r.contentType = m.optString("type", "application/octet-stream");
            r.fetchedAt = m.optLong("t", 0);
            r.body = readAll(new FileInputStream(body));
            r.fromCache = true;
            return r;
        } catch (Exception e) {
            return null;
        }
    }

    private void write(File body, File meta, String url, Result r) {
        try {
            File tmp = new File(body.getPath() + ".tmp");
            FileOutputStream fo = new FileOutputStream(tmp);
            fo.write(r.body);
            fo.close();
            JSONObject m = new JSONObject();
            m.put("url", url);
            m.put("status", r.status);
            m.put("type", r.contentType);
            m.put("t", r.fetchedAt);
            FileOutputStream mo = new FileOutputStream(meta);
            mo.write(m.toString().getBytes("UTF-8"));
            mo.close();
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(body);
        } catch (Exception ignored) {
        }
    }

    private WebResourceResponse toResponse(Result r) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Access-Control-Expose-Headers", "X-Bc-Fetched, X-Bc-Stale");
        h.put("X-Bc-Fetched", String.valueOf(r.fetchedAt));
        h.put("X-Bc-Stale", r.stale ? "1" : "0");
        h.put("Cache-Control", "no-store");
        String type = r.contentType;
        String enc = null;
        int semi = type.indexOf(';');
        if (semi > 0) {
            String rest = type.substring(semi + 1).trim();
            type = type.substring(0, semi).trim();
            if (rest.toLowerCase().startsWith("charset=")) enc = rest.substring(8).trim();
        }
        int status = r.status <= 0 ? 504 : r.status;
        // WebView refuses some 1xx/3xx codes in synthetic responses.
        if (status < 200 || (status >= 300 && status < 400)) status = 502;
        return new WebResourceResponse(type, enc, status, reason(status), h, new ByteArrayInputStream(r.body));
    }

    private static String reason(int s) {
        switch (s) {
            case 200: return "OK";
            case 204: return "No Content";
            case 404: return "Not Found";
            case 429: return "Too Many Requests";
            case 504: return "Gateway Timeout";
            default: return "Status " + s;
        }
    }

    // ------------------------------------------------------------------ Maintenance

    public long sizeBytes() {
        long total = 0;
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) total += f.length();
        return total;
    }

    /** Trim the browsing cache. Files that belong to a downloaded region are never removed. */
    public void trim() {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        List<File> bins = new ArrayList<>();
        long total = 0;
        for (File f : fs) {
            if (f.getName().endsWith(".bin")) {
                String key = f.getName().substring(0, f.getName().length() - 4);
                if (!pinned.contains(key)) { bins.add(f); total += f.length(); }
            } else if (f.getName().endsWith(".tmp")) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        if (total <= BROWSE_CACHE_CAP) return;
        File[] arr = bins.toArray(new File[0]);
        Arrays.sort(arr, new Comparator<File>() {
            @Override public int compare(File a, File b) { return Long.compare(a.lastModified(), b.lastModified()); }
        });
        for (File f : arr) {
            if (total <= BROWSE_CACHE_CAP * 8 / 10) break;
            total -= f.length();
            String key = f.getName().substring(0, f.getName().length() - 4);
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            //noinspection ResultOfMethodCallIgnored
            new File(dir, key + ".meta").delete();
        }
    }

    public void clearUnpinned() {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            String n = f.getName();
            int dot = n.indexOf('.');
            String key = dot > 0 ? n.substring(0, dot) : n;
            if (!pinned.contains(key)) //noinspection ResultOfMethodCallIgnored
                f.delete();
        }
    }

    // ------------------------------------------------------------------ Utils

    public static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        } finally {
            in.close();
        }
    }

    static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".pbf")) return "application/x-protobuf";
        return "application/octet-stream";
    }
}
