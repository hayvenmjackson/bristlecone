package app.bristlecone;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

/**
 * Positioning with an honest fallback chain:
 *   1. GPS (satellite fix) when available and accurate.
 *   2. Network location (Wi-Fi and cell towers) when GPS is out. Flagged as an estimate.
 *   3. Dead reckoning from the last good fix using the step counter, compass and barometer,
 *      with a stride-length model learned on this phone from earlier GPS walks. Flagged as
 *      an estimate with a growing uncertainty circle.
 */
public final class LocationEngine implements LocationListener, SensorEventListener {
    public interface Listener { void onUpdate(JSONObject fix); }

    private static final long GPS_STALE_MS = 12000;
    private static final long NET_STALE_MS = 60000;
    private static final float GOOD_GPS_ACC = 35f;

    private final Context ctx;
    private final Listener listener;
    private final LocationManager lm;
    private final SensorManager sm;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final StrideModel model = new StrideModel();
    private final DeadReckoner dr = new DeadReckoner();

    private boolean running;
    private Location lastGps, lastNet;
    private long lastGpsElapsed, lastNetElapsed;

    // Sensor state
    private final float[] rot = new float[9];
    private final float[] orient = new float[3];
    private double headingMag = Double.NaN;
    private double declination = 0;
    private double baroAlt = Double.NaN, baroAltPrev = Double.NaN;
    private long baroPrevMs;
    private double vSpeed = 0;
    private final long[] stepTimes = new long[16];
    private int stepIdx, stepCount;

    // Training state (steps between two clean GPS fixes)
    private Location trainStart;
    private int trainSteps;
    private double trainAltStart = Double.NaN;

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (!running) return;
            emit();
            main.postDelayed(this, 1000);
        }
    };

    public LocationEngine(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
        this.lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        this.sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        this.prefs = ctx.getSharedPreferences("bristlecone_location", Context.MODE_PRIVATE);
        model.deserialize(prefs.getString("stride", null));
    }

    public boolean hasBarometer() { return sm != null && sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null; }
    public boolean hasStepDetector() { return sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) != null; }
    public int strideSamples() { return model.samples(); }
    public double strideAt(double cadence) { return model.predict(cadence, 0); }

    public void resetStrideModel() {
        model.reset();
        prefs.edit().putString("stride", model.serialize()).apply();
    }

    @SuppressLint("MissingPermission")
    public void start() {
        if (running) return;
        running = true;
        // Registered even when a provider is switched off right now: Android starts delivering
        // fixes as soon as the user turns it on, without an app restart.
        java.util.List<String> all = lm.getAllProviders();
        try {
            if (all.contains(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
        } catch (Exception ignored) { }
        try {
            if (all.contains(LocationManager.NETWORK_PROVIDER))
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 0, this, Looper.getMainLooper());
        } catch (Exception ignored) { }
        try {
            Location g = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location n = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            Location best = g != null ? g : n;
            if (best != null && System.currentTimeMillis() - best.getTime() < 10 * 60 * 1000) {
                dr.anchor(best.getLatitude(), best.getLongitude(),
                        best.getAccuracy() + (System.currentTimeMillis() - best.getTime()) / 1000f,
                        System.currentTimeMillis());
            }
        } catch (Exception ignored) { }
        if (sm != null) {
            Sensor rv = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            if (rv == null) rv = sm.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);
            if (rv != null) sm.registerListener(this, rv, SensorManager.SENSOR_DELAY_UI);
            Sensor st = sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
            if (st != null) sm.registerListener(this, st, SensorManager.SENSOR_DELAY_FASTEST);
            Sensor pr = sm.getDefaultSensor(Sensor.TYPE_PRESSURE);
            if (pr != null) sm.registerListener(this, pr, SensorManager.SENSOR_DELAY_NORMAL);
        }
        main.post(ticker);
    }

    public void stop() {
        if (!running) return;
        running = false;
        try { lm.removeUpdates(this); } catch (Exception ignored) { }
        if (sm != null) sm.unregisterListener(this);
        main.removeCallbacks(ticker);
        prefs.edit().putString("stride", model.serialize()).apply();
    }

    // ------------------------------------------------------------------ Location callbacks

    @Override public void onLocationChanged(Location loc) {
        long now = SystemClock.elapsedRealtime();
        if (LocationManager.GPS_PROVIDER.equals(loc.getProvider())) {
            lastGps = loc; lastGpsElapsed = now;
            declination = new GeomagneticField((float) loc.getLatitude(), (float) loc.getLongitude(),
                    (float) loc.getAltitude(), System.currentTimeMillis()).getDeclination();
            if (loc.getAccuracy() <= GOOD_GPS_ACC) {
                dr.anchor(loc.getLatitude(), loc.getLongitude(), loc.getAccuracy(), System.currentTimeMillis());
                train(loc);
            }
        } else {
            lastNet = loc; lastNetElapsed = now;
            // Re-anchor dead reckoning to the network fix if it is tighter than our estimate.
            if (!gpsFresh() && (!dr.isAnchored() || loc.getAccuracy() < dr.radius())) {
                dr.anchor(loc.getLatitude(), loc.getLongitude(), loc.getAccuracy(), System.currentTimeMillis());
            }
        }
        emit();
    }

    private void train(Location loc) {
        if (loc.getAccuracy() > 15f) { trainStart = null; return; }
        if (trainStart == null) { startTraining(loc); return; }
        double dt = (loc.getTime() - trainStart.getTime()) / 1000.0;
        if (dt < 12) return;
        double dist = DeadReckoner.distance(trainStart.getLatitude(), trainStart.getLongitude(), loc.getLatitude(), loc.getLongitude());
        if (trainSteps >= 12 && dist >= 8 && dt <= 120) {
            double cadence = trainSteps / dt;
            double vs = Double.isNaN(trainAltStart) || Double.isNaN(baroAlt) ? 0 : (baroAlt - trainAltStart) / dt;
            // Straight-line distance undercounts on switchbacks, so only train on fairly straight walking.
            double straightness = dist / Math.max(1, trainSteps * model.predict(cadence, vs));
            if (straightness > 0.75 && model.update(cadence, vs, dist / trainSteps)) {
                prefs.edit().putString("stride", model.serialize()).apply();
            }
        }
        startTraining(loc);
    }

    private void startTraining(Location loc) {
        trainStart = loc;
        trainSteps = 0;
        trainAltStart = baroAlt;
    }

    @Override public void onStatusChanged(String p, int s, Bundle b) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { emit(); }

    // ------------------------------------------------------------------ Sensors

    @Override public void onSensorChanged(SensorEvent e) {
        int type = e.sensor.getType();
        if (type == Sensor.TYPE_ROTATION_VECTOR || type == Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR) {
            SensorManager.getRotationMatrixFromVector(rot, e.values);
            SensorManager.getOrientation(rot, orient);
            double h = Math.toDegrees(orient[0]);
            headingMag = (h + 360) % 360;
        } else if (type == Sensor.TYPE_PRESSURE) {
            double alt = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, e.values[0]);
            long now = SystemClock.elapsedRealtime();
            if (!Double.isNaN(baroAltPrev) && now - baroPrevMs > 2000) {
                double v = (alt - baroAltPrev) / ((now - baroPrevMs) / 1000.0);
                vSpeed = 0.7 * vSpeed + 0.3 * v;
                baroAltPrev = alt; baroPrevMs = now;
            } else if (Double.isNaN(baroAltPrev)) {
                baroAltPrev = alt; baroPrevMs = now;
            }
            baroAlt = Double.isNaN(baroAlt) ? alt : 0.8 * baroAlt + 0.2 * alt;
        } else if (type == Sensor.TYPE_STEP_DETECTOR) {
            long now = SystemClock.elapsedRealtime();
            stepTimes[stepIdx % stepTimes.length] = now;
            stepIdx++;
            stepCount++;
            trainSteps++;
            if (!gpsFresh() && dr.isAnchored() && !Double.isNaN(headingMag)) {
                double cadence = cadence(now);
                double step = model.predict(cadence, vSpeed);
                dr.step(step, (headingMag + declination + 360) % 360, model.confidence(), System.currentTimeMillis());
            }
        }
    }

    private double cadence(long now) {
        int n = Math.min(stepIdx, stepTimes.length);
        if (n < 3) return 1.8;
        long oldest = stepTimes[(stepIdx - n) % stepTimes.length];
        double secs = (now - oldest) / 1000.0;
        if (secs <= 0 || secs > 20) return 1.8;
        return (n - 1) / secs;
    }

    @Override public void onAccuracyChanged(Sensor s, int a) { }

    // ------------------------------------------------------------------ Output

    private boolean gpsFresh() {
        return lastGps != null && SystemClock.elapsedRealtime() - lastGpsElapsed < GPS_STALE_MS
                && lastGps.getAccuracy() <= GOOD_GPS_ACC * 2;
    }

    private void emit() {
        try {
            JSONObject o = new JSONObject();
            long now = SystemClock.elapsedRealtime();
            boolean gpsOn = false, netOn = false;
            try { gpsOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER); } catch (Exception ignored) { }
            try { netOn = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER); } catch (Exception ignored) { }
            o.put("gpsEnabled", gpsOn);
            o.put("networkEnabled", netOn);
            o.put("heading", Double.isNaN(headingMag) ? JSONObject.NULL : (headingMag + declination + 360) % 360);
            o.put("baroAlt", Double.isNaN(baroAlt) ? JSONObject.NULL : baroAlt);
            o.put("steps", stepCount);
            o.put("strideSamples", model.samples());
            if (gpsFresh()) {
                o.put("mode", "gps");
                o.put("lat", lastGps.getLatitude());
                o.put("lon", lastGps.getLongitude());
                o.put("acc", lastGps.getAccuracy());
                o.put("alt", lastGps.hasAltitude() ? lastGps.getAltitude() : JSONObject.NULL);
                o.put("speed", lastGps.hasSpeed() ? lastGps.getSpeed() : JSONObject.NULL);
                o.put("time", lastGps.getTime());
            } else if (lastNet != null && now - lastNetElapsed < NET_STALE_MS && (!dr.isAnchored() || lastNet.getAccuracy() <= dr.radius())) {
                o.put("mode", "network");
                o.put("lat", lastNet.getLatitude());
                o.put("lon", lastNet.getLongitude());
                o.put("acc", lastNet.getAccuracy());
                o.put("time", lastNet.getTime());
            } else if (dr.isAnchored()) {
                dr.tick(System.currentTimeMillis());
                o.put("mode", "estimate");
                o.put("lat", dr.lat());
                o.put("lon", dr.lon());
                o.put("acc", dr.radius());
                o.put("walked", dr.walked());
                o.put("time", System.currentTimeMillis());
            } else {
                o.put("mode", "none");
            }
            listener.onUpdate(o);
        } catch (Exception ignored) {
        }
    }
}
