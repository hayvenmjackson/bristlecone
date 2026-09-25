package app.bristlecone;

import android.content.Context;
import android.content.pm.PackageManager;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.InsertRecordsResponse;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ElevationGainedRecord;
import android.health.connect.datatypes.ExerciseRoute;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.ExerciseSessionType;
import android.health.connect.datatypes.Metadata;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.units.Length;
import android.os.Build;
import android.os.OutcomeReceiver;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;

/**
 * Writes recorded hikes to Health Connect, Android's shared health store, so they appear in
 * Samsung Health, Fitbit and other apps that read from it. Uses the Health Connect built into
 * Android 14 and newer; older phones can share the GPX file instead.
 */
public final class HealthSync {
    public interface Done { void result(boolean ok, String error); }

    public static final String[] PERMISSIONS = {
            "android.permission.health.WRITE_EXERCISE",
            "android.permission.health.WRITE_EXERCISE_ROUTE",
            "android.permission.health.WRITE_DISTANCE",
            "android.permission.health.WRITE_ELEVATION_GAINED",
            "android.permission.health.WRITE_STEPS"
    };

    private HealthSync() {}

    public static boolean available(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return false;
        try { return ctx.getSystemService(HealthConnectManager.class) != null; } catch (Throwable t) { return false; }
    }

    public static boolean granted(Context ctx) {
        if (!available(ctx)) return false;
        for (String p : PERMISSIONS) {
            if (ctx.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    public static void write(Context ctx, JSONObject meta, JSONArray points, final Done done) {
        if (!available(ctx)) { done.result(false, "unavailable"); return; }
        try {
            String id = meta.getString("id");
            Instant start = Instant.ofEpochMilli(meta.getLong("start"));
            Instant end = Instant.ofEpochMilli(Math.max(meta.getLong("end"), meta.getLong("start") + 1000));
            ZoneOffset off = ZoneId.systemDefault().getRules().getOffset(start);
            Metadata.Builder mb = new Metadata.Builder().setClientRecordId(id);
            List<ExerciseRoute.Location> locs = new ArrayList<>();
            for (int i = 0; i < points.length(); i++) {
                JSONArray p = points.getJSONArray(i);
                long t = p.getLong(2);
                if (t < start.toEpochMilli() || t > end.toEpochMilli()) continue;
                ExerciseRoute.Location.Builder lb = new ExerciseRoute.Location.Builder(Instant.ofEpochMilli(t), p.getDouble(1), p.getDouble(0));
                if (!p.isNull(3)) lb.setAltitude(Length.fromMeters(p.getDouble(3)));
                locs.add(lb.build());
            }
            ExerciseSessionRecord.Builder sb = new ExerciseSessionRecord.Builder(mb.build(), start, end, ExerciseSessionType.EXERCISE_SESSION_TYPE_HIKING)
                    .setStartZoneOffset(off).setEndZoneOffset(off);
            String name = meta.optString("name", "");
            if (!name.isEmpty() && !"null".equals(name)) sb.setTitle(name);
            if (locs.size() > 1) sb.setRoute(new ExerciseRoute(locs));
            List<Record> records = new ArrayList<>();
            records.add(sb.build());
            records.add(new DistanceRecord.Builder(new Metadata.Builder().setClientRecordId(id + "-d").build(), start, end,
                    Length.fromMeters(meta.optDouble("distance", 0))).setStartZoneOffset(off).setEndZoneOffset(off).build());
            if (meta.optDouble("gain", 0) > 0) {
                records.add(new ElevationGainedRecord.Builder(new Metadata.Builder().setClientRecordId(id + "-e").build(), start, end,
                        Length.fromMeters(meta.optDouble("gain", 0))).setStartZoneOffset(off).setEndZoneOffset(off).build());
            }
            long steps = meta.optLong("steps", 0);
            if (steps > 0) {
                records.add(new StepsRecord.Builder(new Metadata.Builder().setClientRecordId(id + "-s").build(), start, end, steps)
                        .setStartZoneOffset(off).setEndZoneOffset(off).build());
            }
            HealthConnectManager hcm = ctx.getSystemService(HealthConnectManager.class);
            hcm.insertRecords(records, Executors.newSingleThreadExecutor(), new OutcomeReceiver<InsertRecordsResponse, HealthConnectException>() {
                @Override public void onResult(InsertRecordsResponse r) { done.result(true, null); }
                @Override public void onError(HealthConnectException e) { done.result(false, e.getMessage()); }
            });
        } catch (Throwable t) {
            done.result(false, t.getMessage());
        }
    }
}
