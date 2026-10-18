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
        File f = points(id);
        try (FileWriter w = new FileWriter(f, true)) {
            // If the last write was cut off, start on a fresh line so the new point is not glued to it.
            if (!endsWithNewline(f)) w.write("\n");
            w.write(String.format(Locale.US, "%d,%.6f,%.6f,%.1f,%s,%s\n", t, lat, lon, acc,
                    Double.isNaN(alt) ? "" : String.format(Locale.US, "%.1f", alt),
                    Double.isNaN(baro) ? "" : String.format(Locale.US, "%.1f", baro)));
        } catch (IOException ignored) {
        }
    }

    /** Written to a temporary file and renamed, so a crash mid-write never leaves a half summary. */
    private static boolean endsWithNewline(File f) {
        long n = f.length();
        if (n == 0) return true;
        try (java.io.RandomAccessFile r = new java.io.RandomAccessFile(f, "r")) {
            r.seek(n - 1);
            return r.read() == '\n';
        } catch (IOException e) {
            return true;
        }
    }

    public synchronized void writeMeta(JSONObject m) {
        try {
            File target = meta(m.getString("id"));
            File tmp = new File(dir, target.getName() + ".tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(m.toString().getBytes("UTF-8"));
                o.getFD().sync();
            }
            if (!tmp.renameTo(target)) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }
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
                // A line cut short when Android stopped the app mid-write is skipped on its own;
                // it must not end the read and drop every point recorded after it.
                try {
                    String[] a = line.split(",", -1);
                    if (a.length < 6) continue;
                    double lat = Double.parseDouble(a[1]), lon = Double.parseDouble(a[2]);
                    if (Double.isNaN(lat) || Double.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
                    JSONArray p = new JSONArray();
                    p.put(lon);
                    p.put(lat);
                    p.put(Long.parseLong(a[0]));
                    p.put(a[4].isEmpty() ? JSONObject.NULL : Double.parseDouble(a[4]));
                    out.put(p);
                } catch (NumberFormatException | org.json.JSONException skip) {
                    // damaged line
                }
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
