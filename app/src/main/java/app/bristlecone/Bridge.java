package app.bristlecone;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

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
            o.put("version", "1.0.1");
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

}
