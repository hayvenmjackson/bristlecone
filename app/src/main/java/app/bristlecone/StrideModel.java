package app.bristlecone;

/**
 * On-device learned step-length model used for dead reckoning when GPS drops out.
 *
 * Step length (metres) is predicted as a linear function of:
 *   x0 = 1 (bias)
 *   x1 = cadence (steps per second)
 *   x2 = absolute vertical speed (metres per second, from the barometer)
 *
 * The weights are learned with recursive least squares (RLS) and a forgetting factor,
 * trained every time a clean GPS segment gives us a ground-truth distance for a known
 * number of steps. It starts from a sensible prior for adult walking and personalises
 * itself to the user's gait over time. Pure Java so it can be unit tested off-device.
 */
public final class StrideModel {
    public static final int N = 3;
    private static final double LAMBDA = 0.995;   // forgetting factor: favours recent gait
    private static final double MIN_STEP = 0.30;
    private static final double MAX_STEP = 1.30;

    private final double[] w = new double[N];
    private final double[][] p = new double[N][N];
    private int samples;

    public StrideModel() { reset(); }

    public void reset() {
        // Prior: about 0.70 m per step at 1.8 steps/s on flat ground, shorter steps when climbing.
        w[0] = 0.30; w[1] = 0.22; w[2] = -0.35;
        for (int i = 0; i < N; i++) for (int j = 0; j < N; j++) p[i][j] = (i == j) ? 0.05 : 0.0;
        samples = 0;
    }

    public static double[] features(double cadence, double verticalSpeed) {
        return new double[] { 1.0, clamp(cadence, 0.2, 3.5), Math.min(Math.abs(verticalSpeed), 1.5) };
    }

    public double predict(double cadence, double verticalSpeed) {
        double[] x = features(cadence, verticalSpeed);
        double y = 0;
        for (int i = 0; i < N; i++) y += w[i] * x[i];
        return clamp(y, MIN_STEP, MAX_STEP);
    }

    /** Train on one observed segment: measured metres per step at the given cadence and climb rate. */
    public boolean update(double cadence, double verticalSpeed, double observedStep) {
        if (Double.isNaN(observedStep) || observedStep < MIN_STEP || observedStep > MAX_STEP) return false;
        double[] x = features(cadence, verticalSpeed);
        double[] px = new double[N];
        for (int i = 0; i < N; i++) { double s = 0; for (int j = 0; j < N; j++) s += p[i][j] * x[j]; px[i] = s; }
        double denom = LAMBDA;
        for (int i = 0; i < N; i++) denom += x[i] * px[i];
        double[] k = new double[N];
        for (int i = 0; i < N; i++) k[i] = px[i] / denom;
        double err = observedStep;
        for (int i = 0; i < N; i++) err -= w[i] * x[i];
        for (int i = 0; i < N; i++) w[i] += k[i] * err;
        double[][] np = new double[N][N];
        for (int i = 0; i < N; i++) for (int j = 0; j < N; j++) np[i][j] = (p[i][j] - k[i] * px[j]) / LAMBDA;
        for (int i = 0; i < N; i++) for (int j = 0; j < N; j++) p[i][j] = 0.5 * (np[i][j] + np[j][i]);
        // Keep the covariance from blowing up after long idle periods.
        for (int i = 0; i < N; i++) if (p[i][i] > 1.0) p[i][i] = 1.0;
        samples++;
        return true;
    }

    public int samples() { return samples; }

    /** 0..1 confidence used to scale the uncertainty radius. */
    public double confidence() { return Math.min(1.0, samples / 40.0); }

    public String serialize() {
        StringBuilder sb = new StringBuilder();
        sb.append(samples);
        for (int i = 0; i < N; i++) sb.append(',').append(w[i]);
        for (int i = 0; i < N; i++) for (int j = 0; j < N; j++) sb.append(',').append(p[i][j]);
        return sb.toString();
    }

    public void deserialize(String s) {
        if (s == null || s.isEmpty()) return;
        try {
            String[] a = s.split(",");
            if (a.length != 1 + N + N * N) return;
            int idx = 0;
            int smp = Integer.parseInt(a[idx++]);
            double[] nw = new double[N];
            double[][] np = new double[N][N];
            for (int i = 0; i < N; i++) nw[i] = Double.parseDouble(a[idx++]);
            for (int i = 0; i < N; i++) for (int j = 0; j < N; j++) np[i][j] = Double.parseDouble(a[idx++]);
            System.arraycopy(nw, 0, w, 0, N);
            for (int i = 0; i < N; i++) System.arraycopy(np[i], 0, p[i], 0, N);
            samples = smp;
        } catch (RuntimeException ignored) {
            reset();
        }
    }

    static double clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
}
