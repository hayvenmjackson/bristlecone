package app.bristlecone;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONObject;

/**
 * Records a hike while the screen is off. A foreground service (with its ongoing notification,
 * as Android requires) keeps GPS, the step counter and the barometer running.
 */
public class TrackService extends Service implements LocationListener, SensorEventListener {
    public static final String ACTION_START = "app.bristlecone.track.START";
    public static final String ACTION_PAUSE = "app.bristlecone.track.PAUSE";
    public static final String ACTION_RESUME = "app.bristlecone.track.RESUME";
    public static final String ACTION_STOP = "app.bristlecone.track.STOP";
    private static final String CHANNEL = "recording";
    private static final int NOTIFICATION_ID = 7;

    /** Live state read by the UI through the bridge. */
    public static volatile String currentId;
    public static volatile boolean paused;
    public static volatile TrackStats stats;
    public static volatile int steps;
    public static volatile double lastLat = Double.NaN, lastLon = Double.NaN;

    private TrackStore store;
    private LocationManager lm;
    private SensorManager sm;
    private double baroAlt = Double.NaN;
    private String title = "Bristlecone", text = "Recording your hike";

    public static void send(Context ctx, String action, String title, String text) {
        Intent i = new Intent(ctx, TrackService.class).setAction(action);
        if (title != null) i.putExtra("title", title);
        if (text != null) i.putExtra("text", text);
        if (ACTION_START.equals(action)) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    @Override public void onCreate() {
        super.onCreate();
        store = new TrackStore(this);
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        sm = (SensorManager) getSystemService(SENSOR_SERVICE);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (intent != null && intent.hasExtra("title")) title = intent.getStringExtra("title");
        if (intent != null && intent.hasExtra("text")) text = intent.getStringExtra("text");
        if (ACTION_START.equals(action)) start();
        else if (ACTION_PAUSE.equals(action)) { paused = true; notifyNow(); }
        else if (ACTION_RESUME.equals(action)) { paused = false; notifyNow(); }
        else if (ACTION_STOP.equals(action)) stop();
        else if (currentId == null && !recover()) stopSelf();
        return START_STICKY;
    }

    private void start() {
        goForeground();
        if (currentId != null) return;
        currentId = "t" + System.currentTimeMillis();
        stats = new TrackStats();
        steps = 0;
        paused = false;
        lastLat = Double.NaN; lastLon = Double.NaN;
        getSharedPreferences("track", MODE_PRIVATE).edit().putString("recording", currentId).apply();
        listen();
    }

    /**
     * If Android stopped the app mid-hike, carry on with the same recording: replay the points
     * already on disk into fresh statistics and keep listening.
     */
    private boolean recover() {
        String id = getSharedPreferences("track", MODE_PRIVATE).getString("recording", null);
        if (id == null || !store.points(id).exists()) return false;
        goForeground();
        TrackStats s = new TrackStats();
        org.json.JSONArray pts = store.readPoints(id);
        for (int i = 0; i < pts.length(); i++) {
            org.json.JSONArray p = pts.optJSONArray(i);
            double alt = p.isNull(3) ? Double.NaN : p.optDouble(3);
            s.add(p.optLong(2), p.optDouble(1), p.optDouble(0), 5, alt, Double.NaN);
        }
        stats = s;
        currentId = id;
        paused = false;
        listen();
        return true;
    }

    private void goForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Notification n = notification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NOTIFICATION_ID, n);
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_track)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build();
    }

    private void notifyNow() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, notification());
    }

    @SuppressLint("MissingPermission")
    private void listen() {
        try { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 2, this, Looper.getMainLooper()); } catch (Exception ignored) { }
        if (sm != null) {
            Sensor st = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
            if (st != null) sm.registerListener(this, st, SensorManager.SENSOR_DELAY_NORMAL);
            Sensor pr = sm.getDefaultSensor(Sensor.TYPE_PRESSURE);
            if (pr != null) sm.registerListener(this, pr, SensorManager.SENSOR_DELAY_NORMAL);
        }
    }

    private void stop() {
        try { lm.removeUpdates(this); } catch (Exception ignored) { }
        if (sm != null) sm.unregisterListener(this);
        String id = currentId;
        TrackStats s = stats;
        if (id != null && s != null && s.points() > 1) store.writeMeta(summary(id, s, steps, null));
        else if (id != null) store.delete(id);
        currentId = null;
        getSharedPreferences("track", MODE_PRIVATE).edit().remove("recording").apply();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    static JSONObject summary(String id, TrackStats s, int steps, String name) {
        JSONObject m = new JSONObject();
        try {
            m.put("id", id);
            m.put("name", name == null ? JSONObject.NULL : name);
            m.put("start", s.startTime());
            m.put("end", s.endTime());
            m.put("distance", s.distance());
            m.put("gain", s.gain());
            m.put("loss", s.loss());
            m.put("barometer", s.usedBarometer());
            m.put("movingMs", s.movingMs());
            m.put("elapsedMs", s.elapsedMs());
            m.put("points", s.points());
            m.put("steps", steps);
            m.put("maxAlt", Double.isNaN(s.maxAltitude()) ? JSONObject.NULL : s.maxAltitude());
            m.put("healthSynced", false);
        } catch (Exception ignored) {
        }
        return m;
    }

    // ---------------------------------------------------------------- Callbacks

    @Override public void onLocationChanged(Location loc) {
        if (paused || currentId == null) return;
        double alt = loc.hasAltitude() ? loc.getAltitude() : Double.NaN;
        TrackStats s = stats;
        if (s != null && s.add(loc.getTime(), loc.getLatitude(), loc.getLongitude(), loc.getAccuracy(), alt, baroAlt)) {
            store.appendPoint(currentId, loc.getTime(), loc.getLatitude(), loc.getLongitude(), loc.getAccuracy(), alt, baroAlt);
            lastLat = loc.getLatitude(); lastLon = loc.getLongitude();
        }
    }

    @Override public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() == Sensor.TYPE_STEP_DETECTOR) { if (!paused) steps++; }
        else if (e.sensor.getType() == Sensor.TYPE_PRESSURE) {
            double a = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, e.values[0]);
            baroAlt = Double.isNaN(baroAlt) ? a : 0.8 * baroAlt + 0.2 * a;
        }
    }

    @Override public void onAccuracyChanged(Sensor s, int a) { }
    @Override public void onStatusChanged(String p, int s, Bundle b) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }
    @Override public IBinder onBind(Intent i) { return null; }

    @Override public void onDestroy() {
        try { lm.removeUpdates(this); } catch (Exception ignored) { }
        if (sm != null) sm.unregisterListener(this);
        super.onDestroy();
    }
}
