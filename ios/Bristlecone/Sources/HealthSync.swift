import Foundation
import HealthKit
import CoreLocation

/// Saves recorded hikes to Apple Health: a hiking workout with its route, distance and
/// elevation gained. Write only; the app never reads health data. Steps are left out because
/// the iPhone already counts them itself.
final class HealthSync {
    private let store = HKHealthStore()

    var available: Bool { HKHealthStore.isHealthDataAvailable() }

    private var shareTypes: Set<HKSampleType> {
        [HKObjectType.workoutType(), HKSeriesType.workoutRoute(), HKQuantityType(.distanceWalkingRunning)]
    }

    var granted: Bool {
        available && store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized
    }

    func request(_ done: @escaping (Bool) -> Void) {
        guard available else { done(false); return }
        store.requestAuthorization(toShare: shareTypes, read: []) { [weak self] _, _ in
            DispatchQueue.main.async { done(self?.granted ?? false) }
        }
    }

    func write(meta: [String: Any], fixes: [(Double, Double, Double, Double, Double)], done: @escaping (Bool, String?) -> Void) {
        let finish = { (ok: Bool, err: String?) in DispatchQueue.main.async { done(ok, err) } }
        guard let startMs = (meta["start"] as? NSNumber)?.doubleValue, let endMs = (meta["end"] as? NSNumber)?.doubleValue, endMs > startMs else {
            finish(false, "missing"); return
        }
        let start = Date(timeIntervalSince1970: startMs / 1000), end = Date(timeIntervalSince1970: endMs / 1000)
        let distance = (meta["distance"] as? NSNumber)?.doubleValue ?? 0
        let gain = (meta["gain"] as? NSNumber)?.doubleValue ?? 0

        let config = HKWorkoutConfiguration()
        config.activityType = .hiking
        config.locationType = .outdoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
        builder.beginCollection(withStart: start) { ok, error in
            guard ok else { finish(false, error?.localizedDescription); return }
            var samples: [HKSample] = []
            if distance > 0 {
                samples.append(HKQuantitySample(type: HKQuantityType(.distanceWalkingRunning),
                                                quantity: HKQuantity(unit: .meter(), doubleValue: distance), start: start, end: end))
            }
            var metadata: [String: Any] = [HKMetadataKeyIndoorWorkout: false]
            if gain > 0 { metadata[HKMetadataKeyElevationAscended] = HKQuantity(unit: .meter(), doubleValue: gain) }
            if let name = meta["name"] as? String, !name.isEmpty { metadata[HKMetadataKeyWorkoutBrandName] = "Bristlecone: " + name }
            builder.addMetadata(metadata) { _, _ in
                builder.add(samples) { _, _ in
                    builder.endCollection(withEnd: end) { ok, error in
                        guard ok else { finish(false, error?.localizedDescription); return }
                        builder.finishWorkout { workout, error in
                            guard let workout = workout else { finish(false, error?.localizedDescription); return }
                            self.addRoute(to: workout, fixes: fixes, finish: finish)
                        }
                    }
                }
            }
        }
    }

    private func addRoute(to workout: HKWorkout, fixes: [(Double, Double, Double, Double, Double)], finish: @escaping (Bool, String?) -> Void) {
        guard fixes.count > 1 else { finish(true, nil); return }
        let locations = fixes.map { f in
            CLLocation(coordinate: CLLocationCoordinate2D(latitude: f.1, longitude: f.2),
                       altitude: f.4.isNaN ? 0 : f.4, horizontalAccuracy: f.3, verticalAccuracy: f.4.isNaN ? -1 : 10,
                       timestamp: Date(timeIntervalSince1970: f.0 / 1000))
        }
        let route = HKWorkoutRouteBuilder(healthStore: store, device: .local())
        route.insertRouteData(locations) { ok, _ in
            guard ok else { finish(true, nil); return }   // the workout itself is saved
            route.finishRoute(with: workout, metadata: nil) { _, _ in finish(true, nil) }
        }
    }
}
