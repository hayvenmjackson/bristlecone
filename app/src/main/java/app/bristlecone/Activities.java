package app.bristlecone;

import android.health.connect.datatypes.ExerciseSessionType;

/**
 * Kinds of recorded activity. The ids match js/record.js and the iOS shell.
 *
 * Only walking and hiking train the stride model, since running, snowshoeing and anything on
 * wheels, skis, a horse or water would teach it the wrong step length. Dead reckoning from
 * steps only runs for activities on foot; on a bike or a horse it falls back to network fixes.
 */
public final class Activities {
    private Activities() {}

    public static final String DEFAULT = "hike";

    public static String clean(String id) {
        if (id == null) return DEFAULT;
        switch (id) {
            case "hike": case "walk": case "run": case "snowshoe": case "mtb": case "bike":
            case "horse": case "xcski": case "ski": case "paddle": case "ohv":
                return id;
            default:
                return DEFAULT;
        }
    }

    /** Activities whose steps can be turned into distance with the learned stride model. */
    public static boolean onFoot(String id) {
        String a = clean(id);
        return a.equals("hike") || a.equals("walk") || a.equals("run") || a.equals("snowshoe");
    }

    /** Activities that give the stride model good examples of ordinary walking. */
    public static boolean trainsStride(String id) {
        String a = clean(id);
        return a.equals("hike") || a.equals("walk");
    }

    /** Steps only mean something on foot; a bike or a horse can still shake the step detector. */
    public static boolean countsSteps(String id) { return onFoot(id); }

    /** Health Connect session type, or -1 for activities that are not exercise (motorized travel). */
    public static int healthType(String id) {
        switch (clean(id)) {
            case "walk": return ExerciseSessionType.EXERCISE_SESSION_TYPE_WALKING;
            case "run": return ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING;
            case "snowshoe": return ExerciseSessionType.EXERCISE_SESSION_TYPE_SNOWSHOEING;
            case "mtb": case "bike": return ExerciseSessionType.EXERCISE_SESSION_TYPE_BIKING;
            case "horse": return ExerciseSessionType.EXERCISE_SESSION_TYPE_OTHER_WORKOUT;
            case "xcski": case "ski": return ExerciseSessionType.EXERCISE_SESSION_TYPE_SKIING;
            case "paddle": return ExerciseSessionType.EXERCISE_SESSION_TYPE_PADDLING;
            case "ohv": return -1;
            default: return ExerciseSessionType.EXERCISE_SESSION_TYPE_HIKING;
        }
    }
}
