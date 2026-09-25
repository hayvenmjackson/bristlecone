package app.bristlecone;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.Locale;

/**
 * Recorded hikes on disk: files/tracks/ID.json (summary) and ID.csv (one point per line:
 * time, lat, lon, accuracy, gps altitude, barometric altitude). Included in backups.
 */
public final class TrackStore {
    private final File dir;

    public TrackStore(Context ctx) {
        dir = new File(ctx.getFilesDir(), "tracks");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    static String safe(String id) { return id.replaceAll("[^A-Za-z0-9_-]", "_"); }

    public File points(String id) { return new File(dir, safe(id) + ".csv"); }
    public File meta(String id) { return new File(dir, safe(id) + ".json"); }

    public synchronized void appendPoint(String id, long t, double lat, double lon, double acc, double alt, double baro) {
        try (FileWriter w = new FileWriter(points(id), true)) {
            w.write(String.format(Locale.US, "%d,%.6f,%.6f,%.1f,%s,%s\n", t, lat, lon, acc,
                    Double.isNaN(alt) ? "" : String.format(Locale.US, "%.1f", alt),
                    Double.isNaN(baro) ? "" : String.format(Locale.US, "%.1f", baro)));
        } catch (IOException ignored) {
        }
    }

    public synchronized void writeMeta(JSONObject m) {
        try (FileOutputStream o = new FileOutputStream(meta(m.getString("id")))) {
            o.write(m.toString().getBytes("UTF-8"));
        } catch (Exception ignored) {
        }
    }

    public synchronized JSONObject readMeta(String id) {
        try (FileInputStream in = new FileInputStream(meta(id))) {
            return new JSONObject(new String(NetCache.readAll(in), "UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized JSONArray list() {
        JSONArray out = new JSONArray();
        File[] fs = dir.listFiles();
        if (fs == null) return out;
        for (File f : fs) {
            if (!f.getName().endsWith(".json")) continue;
            JSONObject m = readMeta(f.getName().substring(0, f.getName().length() - 5));
            if (m != null) out.put(m);
        }
        return out;
    }

    /** Points as [[lon, lat, timeMs, altitude-or-null], ...]. Prefers barometric altitude offset to GPS. */
    public synchronized JSONArray readPoints(String id) {
        JSONArray out = new JSONArray();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(points(id)), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] a = line.split(",", -1);
                if (a.length < 6) continue;
                JSONArray p = new JSONArray();
                p.put(Double.parseDouble(a[2]));
                p.put(Double.parseDouble(a[1]));
                p.put(Long.parseLong(a[0]));
                p.put(a[4].isEmpty() ? JSONObject.NULL : Double.parseDouble(a[4]));
                out.put(p);
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    public synchronized void delete(String id) {
        //noinspection ResultOfMethodCallIgnored
        points(id).delete();
        //noinspection ResultOfMethodCallIgnored
        meta(id).delete();
    }

    public File dir() { return dir; }
}
