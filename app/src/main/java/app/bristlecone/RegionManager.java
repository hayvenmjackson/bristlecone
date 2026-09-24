package app.bristlecone;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Downloads a map region (tiles, terrain, trail data, land boundaries) so it works with no
 * signal. The web layer decides which URLs make up a region; this class fetches them in the
 * background, pins them against cache trimming, and reports progress.
 */
public final class RegionManager {
    public interface Listener { void onProgress(JSONObject status); }

    private final File dir;
    private final NetCache net;
    private final Listener listener;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Map<String, AtomicBoolean> cancels = new ConcurrentHashMap<>();

    public RegionManager(Context ctx, NetCache net, Listener listener) {
        this.dir = new File(ctx.getFilesDir(), "regions");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        this.net = net;
        this.listener = listener;
        refreshPins();
    }

    public void start(final JSONObject spec) throws Exception {
        final String id = spec.getString("id");
        final JSONArray urls = spec.getJSONArray("urls");
        final int total = urls.length();
        final AtomicBoolean cancel = new AtomicBoolean(false);
        cancels.put(id, cancel);

        final JSONObject manifest = new JSONObject();
        manifest.put("id", id);
        manifest.put("name", spec.optString("name", "Region"));
        manifest.put("bbox", spec.optJSONArray("bbox"));
        manifest.put("minZoom", spec.optInt("minZoom"));
        manifest.put("maxZoom", spec.optInt("maxZoom"));
        manifest.put("layers", spec.optJSONArray("layers"));
        manifest.put("created", System.currentTimeMillis());
        manifest.put("state", "downloading");
        manifest.put("total", total);
        manifest.put("done", 0);
        manifest.put("failed", 0);
        manifest.put("bytes", 0);
        final JSONArray keys = new JSONArray();
        for (int i = 0; i < total; i++) keys.put(CachePolicy.key(urls.getString(i)));
        manifest.put("keys", keys);
        save(manifest);
        refreshPins();

        final AtomicInteger done = new AtomicInteger();
        final AtomicInteger failed = new AtomicInteger();
        final AtomicLong bytes = new AtomicLong();
        final AtomicLong lastReport = new AtomicLong();

        new Thread(new Runnable() {
            @Override public void run() {
                final Object lock = new Object();
                for (int i = 0; i < total; i++) {
                    if (cancel.get()) break;
                    final String url = urls.optString(i);
                    pool.execute(new Runnable() {
                        @Override public void run() {
                            if (!cancel.get()) {
                                try {
                                    NetCache.Result r = net.isCachedFresh(url) ? null : net.get(url, true);
                                    if (r != null) {
                                        if (r.status == 200 || r.status == 204 || r.status == 404) bytes.addAndGet(r.body.length);
                                        else failed.incrementAndGet();
                                        // Be gentle with volunteer-run data services.
                                        if (url.contains("overpass")) Thread.sleep(1200);
                                    }
                                } catch (Exception e) {
                                    failed.incrementAndGet();
                                }
                            }
                            int d = done.incrementAndGet();
                            long now = System.currentTimeMillis();
                            if (d == total || now - lastReport.get() > 400) {
                                lastReport.set(now);
                                report(manifest, d, failed.get(), bytes.get(), "downloading");
                            }
                            synchronized (lock) { lock.notifyAll(); }
                        }
                    });
                    // Keep the queue short so cancel is quick and memory stays low.
                    synchronized (lock) {
                        while (i - done.get() > 24 && !cancel.get()) {
                            try { lock.wait(250); } catch (InterruptedException ignored) { }
                        }
                    }
                }
                while (done.get() < total && !cancel.get()) {
                    try { Thread.sleep(200); } catch (InterruptedException ignored) { }
                }
                String state = cancel.get() ? "cancelled" : (failed.get() > 0 ? "partial" : "ready");
                report(manifest, done.get(), failed.get(), bytes.get(), state);
                cancels.remove(id);
                if (cancel.get()) delete(id);
            }
        }, "region-" + id).start();
    }

    private void report(JSONObject manifest, int done, int failed, long bytes, String state) {
        try {
            synchronized (manifest) {
                manifest.put("done", done);
                manifest.put("failed", failed);
                manifest.put("bytes", bytes);
                manifest.put("state", state);
                if (!"downloading".equals(state)) save(manifest);
            }
            JSONObject s = new JSONObject();
            s.put("id", manifest.getString("id"));
            s.put("name", manifest.optString("name"));
            s.put("done", done);
            s.put("total", manifest.optInt("total"));
            s.put("failed", failed);
            s.put("bytes", bytes);
            s.put("state", state);
            listener.onProgress(s);
        } catch (Exception ignored) {
        }
    }

    public void cancel(String id) {
        AtomicBoolean c = cancels.get(id);
        if (c != null) c.set(true);
    }

    public void delete(String id) {
        //noinspection ResultOfMethodCallIgnored
        new File(dir, safe(id) + ".json").delete();
        refreshPins();
        net.trim();
    }

    public JSONArray list() {
        JSONArray out = new JSONArray();
        File[] fs = dir.listFiles();
        if (fs == null) return out;
        for (File f : fs) {
            JSONObject m = load(f);
            if (m == null) continue;
            m.remove("keys");
            try {
                if (cancels.containsKey(m.optString("id"))) m.put("state", "downloading");
                else if ("downloading".equals(m.optString("state"))) m.put("state", "partial");
            } catch (Exception ignored) { }
            out.put(m);
        }
        return out;
    }

    public void refreshPins() {
        Set<String> pins = new HashSet<>();
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) {
            JSONObject m = load(f);
            if (m == null) continue;
            JSONArray k = m.optJSONArray("keys");
            if (k != null) for (int i = 0; i < k.length(); i++) pins.add(k.optString(i));
        }
        net.setPinned(pins);
    }

    public File dir() { return dir; }

    private void save(JSONObject m) {
        try {
            FileOutputStream o = new FileOutputStream(new File(dir, safe(m.getString("id")) + ".json"));
            o.write(m.toString().getBytes("UTF-8"));
            o.close();
        } catch (Exception ignored) {
        }
    }

    private static JSONObject load(File f) {
        if (!f.getName().endsWith(".json")) return null;
        try {
            return new JSONObject(new String(NetCache.readAll(new FileInputStream(f)), "UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }

    static String safe(String id) { return id.replaceAll("[^A-Za-z0-9_-]", "_"); }
}
