package app.bristlecone;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    static final int REQ_PERM = 20;
    static final int REQ_BACKUP = 11;
    static final int REQ_RESTORE = 12;
    static final int REQ_EXPORT = 13;

    WebView web;
    NetCache net;
    Storage storage;
    RegionManager regions;
    LocationEngine location;
    final ExecutorService io = Executors.newSingleThreadExecutor();

    boolean backupIncludeMaps;
    byte[] pendingExport;
    boolean wantLocation;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        net = new NetCache(this);
        storage = new Storage(this);
        regions = new RegionManager(this, net, new RegionManager.Listener() {
            @Override public void onProgress(JSONObject s) { callJs("bcNative.onRegionProgress", s.toString()); }
        });
        location = new LocationEngine(this, new LocationEngine.Listener() {
            @Override public void onUpdate(JSONObject fix) { callJs("bcNative.onLocation", fix.toString()); }
        });
        io.execute(new Runnable() { @Override public void run() { net.trim(); } });

        setBars(false);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0F3D2E"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(this), "BristleconeNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return net.intercept(request);
            }
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if (NetCache.APP_HOST.equals(u.getHost())) return false;
                openExternal(url);
                return true;
            }
        });
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        setContentView(web);
        web.loadUrl("https://" + NetCache.APP_HOST + "/index.html");
    }

    // ------------------------------------------------------------------ Lifecycle

    @Override protected void onResume() {
        super.onResume();
        if (wantLocation && hasLocationPermission()) location.start();
        callJs("bcNative.onResume", "{}");
    }

    @Override protected void onPause() {
        super.onPause();
        location.stop();
    }

    @Override protected void onDestroy() {
        location.stop();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("(window.bc && bc.back) ? bc.back() : false", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) {
                if (!"true".equals(v)) MainActivity.super.onBackPressed();
            }
        });
    }

    // ------------------------------------------------------------------ Permissions

    boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    void requestLocation() {
        wantLocation = true;
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION);
            need.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        // Step counting for position estimates needs this on Android 10 and newer.
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission("android.permission.ACTIVITY_RECOGNITION") != PackageManager.PERMISSION_GRANTED) {
            need.add("android.permission.ACTIVITY_RECOGNITION");
        }
        if (need.isEmpty()) {
            location.start();
            notifyPermission();
        } else {
            requestPermissions(need.toArray(new String[0]), REQ_PERM);
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_PERM) {
            if (hasLocationPermission()) location.start();
            notifyPermission();
        }
    }

    void notifyPermission() {
        try {
            JSONObject o = new JSONObject();
            o.put("location", hasLocationPermission());
            o.put("steps", Build.VERSION.SDK_INT < 29 || checkSelfPermission("android.permission.ACTIVITY_RECOGNITION") == PackageManager.PERMISSION_GRANTED);
            callJs("bcNative.onPermission", o.toString());
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ Files (Google Drive via the system picker)

    void startBackup(boolean includeMaps, String filename) {
        backupIncludeMaps = includeMaps;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/zip");
        i.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(i, REQ_BACKUP);
    }

    void startRestore() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/zip", "application/octet-stream", "application/x-zip-compressed" });
        startActivityForResult(i, REQ_RESTORE);
    }

    void startExport(String filename, String mime, String base64) {
        pendingExport = Base64.decode(base64, Base64.DEFAULT);
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(i, REQ_EXPORT);
    }

    @Override protected void onActivityResult(final int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        final Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
        final String kind = requestCode == REQ_BACKUP ? "backup" : requestCode == REQ_RESTORE ? "restore" : "export";
        if (uri == null) { fileResult(kind, false, 0, "cancelled"); return; }
        io.execute(new Runnable() {
            @Override public void run() {
                try {
                    if (requestCode == REQ_BACKUP) {
                        OutputStream o = getContentResolver().openOutputStream(uri, "w");
                        int n = storage.backup(o, backupIncludeMaps);
                        fileResult(kind, true, n, null);
                    } else if (requestCode == REQ_RESTORE) {
                        InputStream in = getContentResolver().openInputStream(uri);
                        int n = storage.restore(in);
                        regions.refreshPins();
                        fileResult(kind, true, n, null);
                    } else if (requestCode == REQ_EXPORT && pendingExport != null) {
                        OutputStream o = getContentResolver().openOutputStream(uri, "w");
                        o.write(pendingExport);
                        o.close();
                        pendingExport = null;
                        fileResult(kind, true, 1, null);
                    }
                } catch (Exception e) {
                    fileResult(kind, false, 0, e.getMessage());
                }
            }
        });
    }

    void fileResult(String kind, boolean ok, int count, String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("kind", kind);
            o.put("ok", ok);
            o.put("count", count);
            o.put("error", error == null ? JSONObject.NULL : error);
            callJs("bcNative.onFileResult", o.toString());
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ Helpers

    /** Only web links, map locations and email leave the app; anything else (intent:, file:, content:, javascript:) is refused. */
    static boolean isSafeExternal(String url) {
        if (url == null) return false;
        String s = Uri.parse(url.trim()).getScheme();
        if (s == null) return false;
        s = s.toLowerCase();
        return s.equals("https") || s.equals("http") || s.equals("geo") || s.equals("mailto");
    }

    void openExternal(String url) {
        if (!isSafeExternal(url)) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception ignored) { }
    }

    void setBars(final boolean dark) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Window w = getWindow();
                w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
                w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                w.setStatusBarColor(Color.parseColor(dark ? "#0B1A14" : "#0F3D2E"));
                w.setNavigationBarColor(Color.parseColor(dark ? "#0B1A14" : "#F6F3EA"));
                int flags = 0;
                if (!dark) flags |= 0x00000010; // SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR (API 26)
                w.getDecorView().setSystemUiVisibility(flags);
            }
        });
    }

    void keepScreenOn(final boolean on) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    void callJs(final String fn, final String json) {
        if (web == null) return;
        final String script = "window.bcNative && " + fn + " && " + fn + "(" + JSONObject.quote(json) + ")";
        web.post(new Runnable() {
            @Override public void run() {
                if (web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    View root() { return web; }
}
