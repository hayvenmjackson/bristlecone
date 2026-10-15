import HealthKit

/// Kinds of recorded activity. The ids match js/record.js and the Android shell.
///
/// Only walking and hiking train the stride model, since running, snowshoeing and anything on
/// wheels, skis, a horse or water would teach it the wrong step length. Dead reckoning from
/// steps only runs for activities on foot; on a bike or a horse it falls back to coarse fixes.
enum Activities {
    static let defaultId = "hike"
    private static let all: Set<String> = ["hike", "walk", "run", "snowshoe", "mtb", "bike", "horse", "xcski", "ski", "paddle", "ohv"]

    static func clean(_ id: String?) -> String {
        guard let id = id, all.contains(id) else { return defaultId }
        return id
    }

    /// Activities whose steps can be turned into distance with the learned stride model.
    static func onFoot(_ id: String?) -> Bool { ["hike", "walk", "run", "snowshoe"].contains(clean(id)) }

    /// Activities that give the stride model good examples of ordinary walking.
    static func trainsStride(_ id: String?) -> Bool { ["hike", "walk"].contains(clean(id)) }

    /// Apple Health workout type, or nil for activities that are not exercise (motorized travel).
    static func workoutType(_ id: String?) -> HKWorkoutActivityType? {
        switch clean(id) {
        case "walk": return .walking
        case "run": return .running
        case "snowshoe": return .snowSports
        case "mtb", "bike": return .cycling
        case "horse": return .equestrianSports
        case "xcski": return .crossCountrySkiing
        case "ski": return .downhillSkiing
        case "paddle": return .paddleSports
        case "ohv": return nil
        default: return .hiking
        }
    }

    /// The Apple Health distance type that fits the activity, if there is one.
    static func distanceType(_ id: String?) -> HKQuantityType? {
        if onFoot(id) { return HKQuantityType(.distanceWalkingRunning) }
        if ["mtb", "bike"].contains(clean(id)) { return HKQuantityType(.distanceCycling) }
        return nil
    }
}
