package app.bristlecone;

/**
 * Position estimator used when GPS is unavailable. Starts from the last trustworthy fix,
 * advances one step at a time along the compass heading using the learned stride model,
 * and grows an honest uncertainty radius as it goes. Pure Java for off-device testing.
 */
public final class DeadReckoner {
    private static final double EARTH_R = 6371008.8;
    /** Radius growth per metre walked (heading error plus stride error). */
    private static final double GROWTH_PER_M_TRAINED = 0.12;
    private static final double GROWTH_PER_M_PRIOR = 0.22;
    /** Slow drift while standing still or when steps go uncounted (metres per second). */
    private static final double GROWTH_PER_S = 0.15;
    public static final double MAX_RADIUS = 5000;

    private boolean anchored;
    private double lat, lon, radius;
    private long lastMs;
    private double walked;

    public void anchor(double lat, double lon, double accuracy, long timeMs) {
        this.lat = lat; this.lon = lon;
        this.radius = Math.max(accuracy, 5);
        this.lastMs = timeMs;
        this.walked = 0;
        this.anchored = true;
    }

    public boolean isAnchored() { return anchored; }

    /** Advance one step. heading is degrees clockwise from true north. */
    public void step(double stepMetres, double headingDeg, double modelConfidence, long timeMs) {
        if (!anchored) return;
        tick(timeMs);
        double[] ll = offset(lat, lon, stepMetres, headingDeg);
        lat = ll[0]; lon = ll[1];
        walked += stepMetres;
        double g = GROWTH_PER_M_PRIOR + (GROWTH_PER_M_TRAINED - GROWTH_PER_M_PRIOR) * modelConfidence;
        radius = Math.min(MAX_RADIUS, radius + g * stepMetres);
    }

    /** Account for elapsed time with no steps. */
    public void tick(long timeMs) {
        if (!anchored) return;
        if (timeMs > lastMs) {
            radius = Math.min(MAX_RADIUS, radius + GROWTH_PER_S * (timeMs - lastMs) / 1000.0);
            lastMs = timeMs;
        }
    }

    public double lat() { return lat; }
    public double lon() { return lon; }
    public double radius() { return radius; }
    public double walked() { return walked; }

    public static double[] offset(double lat, double lon, double dist, double bearingDeg) {
        double d = dist / EARTH_R;
        double b = Math.toRadians(bearingDeg);
        double p1 = Math.toRadians(lat), l1 = Math.toRadians(lon);
        double p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
        double l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
        return new double[] { Math.toDegrees(p2), ((Math.toDegrees(l2) + 540) % 360) - 180 };
    }

    public static double distance(double lat1, double lon1, double lat2, double lon2) {
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dp = p2 - p1, dl = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
    }
}
