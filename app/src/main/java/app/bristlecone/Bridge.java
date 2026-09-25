package app.bristlecone;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;

import java.util.Locale;

/** Methods the web UI can call. Everything crosses as strings or JSON strings. */
public final class Bridge {
    private final MainActivity a;

    Bridge(MainActivity a) { this.a = a; }

    @JavascriptInterface public String info() {
        try {
            JSONObject o = new JSONObject();
            Locale l = Locale.getDefault();
            o.put("locale", l.getLanguage() + "-" + l.getCountry());
            o.put("version", "1.2.0");
            o.put("health", HealthSync.available(a));
            o.put("healthGranted", HealthSync.granted(a));
            o.put("openedFor", a.openedFor == null ? JSONObject.NULL : a.openedFor);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("barometer", a.location.hasBarometer());
            o.put("stepDetector", a.location.hasStepDetector());
            o.put("locationPermission", a.hasLocationPermission());
            o.put("online", a.net.isOnline());
            o.put("strideSamples", a.location.strideSamples());
            o.put("strideAt18", a.location.strideAt(1.8));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface public boolean online() { return a.net.isOnline(); }

    @JavascriptInterface public void requestLocation() {
        a.runOnUiThread(new Runnable() { @Override public void run() { a.requestLocation(); } });
    }

    @JavascriptInterface public void stopLocation() {
        a.runOnUiThread(new Runnable() { @Override public void run() { a.wantLocation = false; a.location.stop(); } });
    }

    @JavascriptInterface public void resetStride() { a.location.resetStrideModel(); }

    // Key-value storage
    @JavascriptInterface public String kvGet(String key) { return a.storage.get(key); }
    @JavascriptInterface public boolean kvPut(String key, String value) { return a.storage.put(key, value); }
    @JavascriptInterface public void kvRemove(String key) { a.storage.remove(key); }
    @JavascriptInterface public String kvKeys(String prefix) { return a.storage.keys(prefix).toString(); }

    // Offline regions
    @JavascriptInterface public String downloadRegion(String specJson) {
        try {
            a.regions.start(new JSONObject(specJson));
            return "ok";
        } catch (Exception e) {
            return "error: " + e.getMessage();
        }
    }
    @JavascriptInterface public void cancelRegion(String id) { a.regions.cancel(id); }
    @JavascriptInterface public void deleteRegion(final String id) {
        a.io.execute(new Runnable() { @Override public void run() { a.regions.delete(id); } });
    }
    @JavascriptInterface public String listRegions() { return a.regions.list().toString(); }

    @JavascriptInterface public String storageStats() {
        try {
            JSONObject o = new JSONObject();
            o.put("cacheBytes", a.net.sizeBytes());
            o.put("dataBytes", a.storage.kvBytes());
            o.put("freeBytes", a.getFilesDir().getUsableSpace());
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface public void clearBrowseCache() {
        a.io.execute(new Runnable() { @Override public void run() { a.net.clearUnpinned(); } });
    }

    // Files and Google Drive (through the system document picker)
    @JavascriptInterface public void backup(final boolean includeMaps, final String filename) {
        a.runOnUiThread(new Runnable() { @Override public void run() { a.startBackup(includeMaps, filename); } });
    }
    @JavascriptInterface public void restore() {
        a.runOnUiThread(new Runnable() { @Override public void run() { a.startRestore(); } });
    }
    @JavascriptInterface public void saveFile(final String filename, final String mime, final String base64) {
        a.runOnUiThread(new Runnable() { @Override public void run() { a.startExport(filename, mime, base64); } });
    }

    // System
    @JavascriptInterface public void openExternal(String url) { a.openExternal(url); }
    @JavascriptInterface public void setDark(boolean dark) { a.setBars(dark); }
    @JavascriptInterface public void keepScreenOn(boolean on) { a.keepScreenOn(on); }

    @JavascriptInterface public void copy(String text) {
        ClipboardManager cm = (ClipboardManager) a.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Bristlecone", text));
    }

    @JavascriptInterface public void share(String text) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("text/plain");
        i.putExtra(Intent.EXTRA_TEXT, text);
        Intent chooser = Intent.createChooser(i, "Bristlecone");
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        a.startActivity(chooser);
    }


    // ---------------------------------------------------------------- Recording a hike

    @JavascriptInterface public void trackStart(final String title, final String text) {
        a.runOnUiThread(new Runnable() { @Override public void run() { a.startRecording(title, text); } });
    }
    @JavascriptInterface public void trackPause() { TrackService.send(a, TrackService.ACTION_PAUSE, null, null); }
    @JavascriptInterface public void trackResume() { TrackService.send(a, TrackService.ACTION_RESUME, null, null); }
    @JavascriptInterface public String trackStop() {
        String id = TrackService.currentId;
        TrackService.send(a, TrackService.ACTION_STOP, null, null);
        return id == null ? "" : id;
    }

    @JavascriptInterface public String trackStatus() {
        try {
            JSONObject o = new JSONObject();
            TrackStats s = TrackService.stats;
            String id = TrackService.currentId;
            o.put("recording", id != null);
            if (id == null || s == null) return o.toString();
            o.put("id", id);
            o.put("paused", TrackService.paused);
            o.put("distance", s.distance());
            o.put("gain", s.gain());
            o.put("movingMs", s.movingMs());
            o.put("elapsedMs", System.currentTimeMillis() - (s.startTime() > 0 ? s.startTime() : System.currentTimeMillis()));
            o.put("points", s.points());
            o.put("steps", TrackService.steps);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface public String trackList() { return a.tracks.list().toString(); }
    @JavascriptInterface public String trackPoints(String id) { return a.tracks.readPoints(id).toString(); }
    @JavascriptInterface public String trackMeta(String id) { JSONObject m = a.tracks.readMeta(id); return m == null ? "null" : m.toString(); }
    @JavascriptInterface public void trackDelete(String id) { a.tracks.delete(id); }
    @JavascriptInterface public boolean trackUpdate(String json) {
        try {
            JSONObject in = new JSONObject(json);
            JSONObject m = a.tracks.readMeta(in.getString("id"));
            if (m == null) return false;
            if (in.has("name")) m.put("name", in.getString("name"));
            if (in.has("healthSynced")) m.put("healthSynced", in.getBoolean("healthSynced"));
            if (in.has("demGain")) m.put("demGain", in.getDouble("demGain"));
            a.tracks.writeMeta(m);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- Sharing

    /** Shares a file (a route card image or a GPX track) plus a caption through Android's share sheet. */
    @JavascriptInterface public boolean shareFile(String base64, String filename, String mime, String text) {
        try {
            String name = filename.replaceAll("[^A-Za-z0-9._-]", "_");
            File f = new File(ShareProvider.dir(a), name);
            FileOutputStream o = new FileOutputStream(f);
            o.write(Base64.decode(base64, Base64.DEFAULT));
            o.close();
            Uri uri = ShareProvider.uriFor(name);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
            i.setClipData(ClipData.newRawUri(name, uri));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(i, "Bristlecone");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            a.startActivity(chooser);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Opens the phone's messaging app with a prepared text (for example, where you are). */
    @JavascriptInterface public void sms(String body) {
        try {
            Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:"));
            i.putExtra("sms_body", body);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(i);
        } catch (Exception e) {
            share(body);
        }
    }

    // ---------------------------------------------------------------- Health Connect

    @JavascriptInterface public void healthRequest() {
        a.runOnUiThread(new Runnable() { @Override public void run() { a.requestHealth(); } });
    }

    @JavascriptInterface public void healthWrite(final String id) {
        final JSONObject meta = a.tracks.readMeta(id);
        final JSONArray pts = a.tracks.readPoints(id);
        if (meta == null) { a.healthResult(id, false, "missing"); return; }
        HealthSync.write(a, meta, pts, new HealthSync.Done() {
            @Override public void result(boolean ok, String error) {
                if (ok) { try { meta.put("healthSynced", true); a.tracks.writeMeta(meta); } catch (Exception ignored) { } }
                a.healthResult(id, ok, error);
            }
        });
    }
}
