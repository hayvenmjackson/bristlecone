package app.bristlecone;

/** Plain-Java tests for the pure logic classes. Run with tools/test-logic.sh (no Android needed). */
public class LogicTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS " : "FAIL ") + what); if (!ok) fails++; }

    public static void main(String[] a) {
        // Stride model: starts near 0.70 m at 1.8 steps/s and learns a longer stride.
        StrideModel m = new StrideModel();
        double p0 = m.predict(1.8, 0);
        check(Math.abs(p0 - 0.696) < 0.01, "prior stride ~0.70 m (got " + p0 + ")");
        for (int i = 0; i < 60; i++) m.update(1.8 + (i % 3) * 0.1, 0, 0.85 + (i % 3) * 0.02);
        double p1 = m.predict(1.9, 0);
        check(Math.abs(p1 - 0.87) < 0.03, "learned stride ~0.87 m (got " + p1 + ")");
        check(m.samples() == 60, "sample count");
        check(!m.update(1.8, 0, 3.0), "rejects impossible 3 m step");
        StrideModel m2 = new StrideModel(); m2.deserialize(m.serialize());
        check(Math.abs(m2.predict(1.9, 0) - p1) < 1e-9 && m2.samples() == 60, "serialize round trip");
        m2.deserialize("garbage,1,2"); check(m2.samples() == 60, "bad serialized data ignored");
        check(m.predict(10, 0) <= 1.3 && m.predict(0, 0) >= 0.3, "prediction clamped");

        // Dead reckoning: 100 steps of 0.8 m due east from a known point.
        DeadReckoner dr = new DeadReckoner();
        dr.anchor(44.0, -71.0, 5, 0);
        for (int i = 1; i <= 100; i++) dr.step(0.8, 90, 0.0, i * 500L);
        double d = DeadReckoner.distance(44.0, -71.0, dr.lat(), dr.lon());
        check(Math.abs(d - 80) < 0.5, "moved 80 m (got " + d + ")");
        check(Math.abs(dr.lat() - 44.0) < 1e-5 && dr.lon() > -71.0, "moved east");
        check(dr.radius() > 5 + 80 * 0.2, "uncertainty grows with distance (" + dr.radius() + ")");
        double r0 = dr.radius(); dr.tick(50000 + 60000); check(dr.radius() > r0, "uncertainty grows with time");
        check(Math.abs(DeadReckoner.distance(0, 0, 0, 1) - 111195) < 20, "haversine 1 deg at equator");

        // Cache policy
        check(CachePolicy.classify("https://tiles.openfreemap.org/planet/20260915_001001_pt/12/1/2.pbf") == CachePolicy.Kind.TILE, "OFM tile is TILE");
        check(CachePolicy.classify("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/1/2.png") == CachePolicy.Kind.TILE, "DEM is TILE");
        check(CachePolicy.classify("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf") == CachePolicy.Kind.TILE, "glyphs TILE");
        check(CachePolicy.classify("https://api.weather.gov/alerts/active?point=1,2") == CachePolicy.Kind.LIVE, "NWS LIVE");
        check(CachePolicy.classify("https://developer.nps.gov/api/v1/alerts?parkCode=yell") == CachePolicy.Kind.LIVE, "NPS alerts LIVE");
        check(CachePolicy.classify("https://developer.nps.gov/api/v1/parks?stateCode=WY") == CachePolicy.Kind.DATA, "NPS parks DATA");
        check(CachePolicy.classify("https://overpass-api.de/api/interpreter?data=x") == CachePolicy.Kind.DATA, "Overpass DATA");
        check(CachePolicy.classify("https://services3.arcgis.com/x/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?f=geojson") == CachePolicy.Kind.LIVE, "fire LIVE");
        check(CachePolicy.classify("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/3/2/1") == CachePolicy.Kind.TILE, "USGS tile TILE");
        check(CachePolicy.key("https://tiles.openfreemap.org/planet/20260915_001001_pt/12/1/2.pbf").equals(CachePolicy.key("https://tiles.openfreemap.org/planet/20261001_001001_pt/12/1/2.pbf")), "OFM version-independent key");
        check(!CachePolicy.key("https://tiles.openfreemap.org/planet/20260915_001001_pt/12/1/2.pbf").equals(CachePolicy.key("https://tiles.openfreemap.org/planet/20260915_001001_pt/12/1/3.pbf")), "distinct tiles distinct keys");
        check(CachePolicy.host("https://api.weather.gov:443/x").equals("api.weather.gov"), "host parse");


        // Hike statistics: jitter ignored, distance and climb counted, gaps not counted as moving
        TrackStats ts = new TrackStats();
        long t0 = 1_000_000L;
        for (int i = 0; i <= 100; i++) {
            double lat = 44.0 + i * 0.00009;                   // about 10 m per step north
            double jitter = (i % 2 == 0 ? 1 : -1) * 0.00001;   // about 1 m of GPS wobble east-west
            ts.add(t0 + i * 5000L, lat, -71.0 + jitter, 5, 300 + i * 2.0, 1000 + i * 2.0);
        }
        for (int i = 0; i < 20; i++) ts.add(t0 + 505000L + i * 5000L, 44.009 + 0.000005 * (i % 3), -71.0, 5, 500, 1200);
        check(Math.abs(ts.distance() - 1000) < 30, "hike distance ~1,000 m (got " + Math.round(ts.distance()) + ")");
        check(Math.abs(ts.gain() - 200) < 8 && ts.usedBarometer(), "climb from barometer ~200 m (got " + Math.round(ts.gain()) + ")");
        check(Math.abs(ts.movingMs() - 500000) < 10000, "moving time excludes standing still (" + ts.movingMs() / 1000 + " s)");
        check(!ts.add(t0 + 700000L, 44.02, -71.0, 80, 0, 0), "rejects a 80 m accuracy fix");
        TrackStats flat = new TrackStats();
        for (int i = 0; i < 200; i++) flat.add(t0 + i * 3000L, 44.0 + i * 0.00005, -71.0, 5, 300 + ((i % 4) - 1.5) * 3, Double.NaN);
        check(flat.gain() < 10 && !flat.usedBarometer(), "GPS altitude noise does not count as climbing (" + Math.round(flat.gain()) + " m)");
        System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
