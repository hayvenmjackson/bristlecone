package app.bristlecone;

/**
 * Running statistics for a recorded hike. Pure Java so it can be tested off-device.
 *
 * GPS jitter is filtered (a new point must be farther from the last kept point than the noise
 * would explain), moving time only counts real movement, and elevation gain uses the barometer
 * when the phone has one (much steadier than GPS altitude) with a hysteresis band so small
 * wobbles do not add up to phantom climbing.
 */
public final class TrackStats {
    public static final double MAX_ACCURACY = 40;      // metres; worse fixes are not recorded
    private static final double BARO_BAND = 3.0;        // metres of hysteresis for barometric gain
    private static final double GPS_BAND = 10.0;        // wider band for noisier GPS altitude
    private static final double MIN_MOVING_SPEED = 0.3; // m/s
    private static final long MAX_GAP_MS = 60_000;      // longer gaps do not count as moving time

    private boolean has;
    private double lastLat, lastLon;
    private long lastT, startT, endT;
    private double distance, movingMs;
    private int kept;

    private double baroRef = Double.NaN, gpsRef = Double.NaN;
    private double baroGain, baroLoss, gpsGain, gpsLoss;
    private boolean sawBaro;
    private final double[] gpsWin = new double[5];
    private int gpsN;
    private double maxAlt = Double.NaN, minAlt = Double.NaN;

    /** Returns true if the point was kept (and should be written to the track). */
    public boolean add(long t, double lat, double lon, double acc, double gpsAlt, double baroAlt) {
        if (acc > MAX_ACCURACY || Double.isNaN(lat) || Double.isNaN(lon)) return false;
        if (!has) {
            has = true; startT = t; endT = t; lastT = t; lastLat = lat; lastLon = lon; kept = 1;
            elevation(gpsAlt, baroAlt);
            return true;
        }
        double d = DeadReckoner.distance(lastLat, lastLon, lat, lon);
        double noise = Math.max(3.0, acc * 0.6);
        if (d < noise) { endT = Math.max(endT, t); elevation(gpsAlt, baroAlt); return false; }
        long dt = t - lastT;
        if (dt > 0 && dt <= MAX_GAP_MS && d / (dt / 1000.0) >= MIN_MOVING_SPEED) movingMs += dt;
        distance += d;
        lastLat = lat; lastLon = lon; lastT = t; endT = t; kept++;
        elevation(gpsAlt, baroAlt);
        return true;
    }

    private void elevation(double gpsAlt, double baroAlt) {
        if (!Double.isNaN(baroAlt)) {
            sawBaro = true;
            if (Double.isNaN(baroRef)) baroRef = baroAlt;
            else if (baroAlt - baroRef >= BARO_BAND) { baroGain += baroAlt - baroRef; baroRef = baroAlt; }
            else if (baroRef - baroAlt >= BARO_BAND) { baroLoss += baroRef - baroAlt; baroRef = baroAlt; }
        }
        if (!Double.isNaN(gpsAlt)) {
            // Average the last five GPS altitudes before applying the band; single fixes wander.
            gpsWin[gpsN % gpsWin.length] = gpsAlt;
            gpsN++;
            int n = Math.min(gpsN, gpsWin.length);
            double avg = 0;
            for (int i = 0; i < n; i++) avg += gpsWin[i];
            avg /= n;
            if (Double.isNaN(gpsRef)) gpsRef = avg;
            else if (avg - gpsRef >= GPS_BAND) { gpsGain += avg - gpsRef; gpsRef = avg; }
            else if (gpsRef - avg >= GPS_BAND) { gpsLoss += gpsRef - avg; gpsRef = avg; }
            maxAlt = Double.isNaN(maxAlt) ? gpsAlt : Math.max(maxAlt, gpsAlt);
            minAlt = Double.isNaN(minAlt) ? gpsAlt : Math.min(minAlt, gpsAlt);
        }
    }

    public double distance() { return distance; }
    public double gain() { return sawBaro ? baroGain : gpsGain; }
    public double loss() { return sawBaro ? baroLoss : gpsLoss; }
    public boolean usedBarometer() { return sawBaro; }
    public long movingMs() { return (long) movingMs; }
    public long startTime() { return startT; }
    public long endTime() { return endT; }
    public long elapsedMs() { return has ? endT - startT : 0; }
    public int points() { return kept; }
    public double maxAltitude() { return maxAlt; }
    public double minAltitude() { return minAlt; }
}
