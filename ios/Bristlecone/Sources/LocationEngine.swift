import Foundation
import CoreLocation
import CoreMotion

/// Positioning with an honest fallback chain, as on Android:
///   1. A satellite-quality fix when one is available.
///   2. A coarse fix (Wi-Fi and cell) when it is not. Flagged as an estimate.
///   3. Dead reckoning from the last good fix using the step counter, compass and barometer,
///      with a stride length learned on this device from earlier walks. Flagged as an estimate
///      with a growing uncertainty circle.
/// iOS blends its sources itself, so the mode comes from the reported accuracy.
final class LocationEngine: NSObject, CLLocationManagerDelegate {
    private static let fixStaleMs = 12_000.0
    private static let coarseStaleMs = 60_000.0
    private static let goodAccuracy = 35.0

    let manager = CLLocationManager()
    var onUpdate: (([String: Any]) -> Void)?
    var onAuthorization: (() -> Void)?

    private let pedometer = CMPedometer()
    private let altimeter = CMAltimeter()
    private let model = StrideModel()
    private let dr = DeadReckoner()
    private var running = false
    private var timer: Timer?

    private var lastFine: CLLocation?, lastCoarse: CLLocation?
    private var lastFineAt = 0.0, lastCoarseAt = 0.0
    private var heading = Double.nan
    private var relAlt = Double.nan, absAlt = Double.nan
    private var relAltPrev = Double.nan, relAltPrevAt = 0.0
    private var vSpeed = 0.0
    private var pedSteps = 0, stepCount = 0
    private var cadenceNow = Double.nan

    // Training: steps between two clean fixes.
    private var trainStart: CLLocation?
    private var trainSteps = 0
    private var trainAltStart = Double.nan

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .fitness
        manager.headingFilter = 2
        model.deserialize(UserDefaults.standard.string(forKey: "stride"))
    }

    var hasBarometer: Bool { CMAltimeter.isRelativeAltitudeAvailable() }
    var hasStepCounter: Bool { CMPedometer.isStepCountingAvailable() }
    var strideSamples: Int { model.samples }
    func strideAt(_ cadence: Double) -> Double { model.predict(cadence: cadence, verticalSpeed: 0) }

    var authorized: Bool {
        let s = manager.authorizationStatus
        return s == .authorizedWhenInUse || s == .authorizedAlways
    }

    func resetStride() {
        model.reset()
        UserDefaults.standard.set(model.serialize(), forKey: "stride")
    }

    /// Asks for permission if needed, then starts. The answer arrives through onAuthorization.
    func request() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        else { start(); onAuthorization?() }
    }

    func start() {
        guard !running, authorized else { return }
        running = true
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
        if let l = manager.location, -l.timestamp.timeIntervalSinceNow < 600 {
            dr.anchor(lat: l.coordinate.latitude, lon: l.coordinate.longitude,
                      accuracy: l.horizontalAccuracy - l.timestamp.timeIntervalSinceNow, timeMs: NetCache.now())
        }
        if CMPedometer.isStepCountingAvailable() {
            pedSteps = 0
            pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                guard let d = data else { return }
                DispatchQueue.main.async { self?.stepsUpdated(d) }
            }
        }
        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] d, _ in
                if let d = d { self?.altitude(d.relativeAltitude.doubleValue) }
            }
        }
        if CMAltimeter.isAbsoluteAltitudeAvailable() {
            altimeter.startAbsoluteAltitudeUpdates(to: .main) { [weak self] d, _ in
                if let d = d { self?.absAlt = d.altitude }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.emit() }
    }

    func stop() {
        guard running else { return }
        running = false
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
        pedometer.stopUpdates()
        altimeter.stopRelativeAltitudeUpdates()
        altimeter.stopAbsoluteAltitudeUpdates()
        timer?.invalidate(); timer = nil
        UserDefaults.standard.set(model.serialize(), forKey: "stride")
    }

    // MARK: CoreLocation

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        if authorized { start() }
        onAuthorization?()
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        let now = NetCache.now()
        for l in locs where l.horizontalAccuracy >= 0 {
            if l.horizontalAccuracy <= LocationEngine.goodAccuracy * 2 {
                lastFine = l; lastFineAt = now
                if l.horizontalAccuracy <= LocationEngine.goodAccuracy {
                    dr.anchor(lat: l.coordinate.latitude, lon: l.coordinate.longitude, accuracy: l.horizontalAccuracy, timeMs: now)
                    train(l)
                }
            } else {
                lastCoarse = l; lastCoarseAt = now
                if !fineFresh && (!dr.anchored || l.horizontalAccuracy < dr.radius) {
                    dr.anchor(lat: l.coordinate.latitude, lon: l.coordinate.longitude, accuracy: l.horizontalAccuracy, timeMs: now)
                }
            }
        }
        emit()
    }

    func locationManager(_ m: CLLocationManager, didUpdateHeading h: CLHeading) {
        if h.headingAccuracy < 0 { return }
        heading = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) { emit() }

    // MARK: Motion

    private func stepsUpdated(_ d: CMPedometerData) {
        let total = d.numberOfSteps.intValue
        let delta = total - pedSteps
        pedSteps = total
        guard delta > 0 else { return }
        stepCount += delta
        trainSteps += delta
        if let c = d.currentCadence?.doubleValue, c > 0 { cadenceNow = c }
        if !fineFresh && dr.anchored && !heading.isNaN {
            let cadence = cadenceNow.isNaN ? 1.8 : cadenceNow
            let step = model.predict(cadence: cadence, verticalSpeed: vSpeed)
            dr.step(metres: step * Double(delta), heading: heading, confidence: model.confidence, timeMs: NetCache.now())
        }
    }

    private func altitude(_ rel: Double) {
        let now = NetCache.now()
        if relAltPrev.isNaN { relAltPrev = rel; relAltPrevAt = now }
        else if now - relAltPrevAt > 2000 {
            let v = (rel - relAltPrev) / ((now - relAltPrevAt) / 1000)
            vSpeed = 0.7 * vSpeed + 0.3 * v
            relAltPrev = rel; relAltPrevAt = now
        }
        relAlt = relAlt.isNaN ? rel : 0.8 * relAlt + 0.2 * rel
    }

    private func train(_ l: CLLocation) {
        if l.horizontalAccuracy > 15 { trainStart = nil; return }
        guard let s = trainStart else { startTraining(l); return }
        let dt = l.timestamp.timeIntervalSince(s.timestamp)
        if dt < 12 { return }
        let dist = l.distance(from: s)
        if trainSteps >= 12 && dist >= 8 && dt <= 120 {
            let cadence = Double(trainSteps) / dt
            let vs = trainAltStart.isNaN || relAlt.isNaN ? 0 : (relAlt - trainAltStart) / dt
            // Straight-line distance undercounts on switchbacks, so only train on fairly straight walking.
            let straightness = dist / max(1, Double(trainSteps) * model.predict(cadence: cadence, verticalSpeed: vs))
            if straightness > 0.75 && model.update(cadence: cadence, verticalSpeed: vs, observedStep: dist / Double(trainSteps)) {
                UserDefaults.standard.set(model.serialize(), forKey: "stride")
            }
        }
        startTraining(l)
    }

    private func startTraining(_ l: CLLocation) {
        trainStart = l
        trainSteps = 0
        trainAltStart = relAlt
    }

    // MARK: Output

    private var fineFresh: Bool { lastFine != nil && NetCache.now() - lastFineAt < LocationEngine.fixStaleMs }

    private func emit() {
        let now = NetCache.now()
        var o: [String: Any] = [
            "gpsEnabled": CLLocationManager.locationServicesEnabled() && authorized,
            "networkEnabled": CLLocationManager.locationServicesEnabled() && authorized,
            "heading": heading.isNaN ? NSNull() as Any : heading,
            "baroAlt": absAlt.isNaN ? NSNull() as Any : absAlt,
            "steps": stepCount,
            "strideSamples": model.samples
        ]
        func put(_ l: CLLocation, _ mode: String) {
            o["mode"] = mode
            o["lat"] = l.coordinate.latitude
            o["lon"] = l.coordinate.longitude
            o["acc"] = l.horizontalAccuracy
            o["time"] = l.timestamp.timeIntervalSince1970 * 1000
            if mode == "gps" {
                o["alt"] = l.verticalAccuracy >= 0 ? l.altitude as Any : NSNull()
                o["speed"] = l.speed >= 0 ? l.speed as Any : NSNull()
            }
        }
        if fineFresh, let l = lastFine {
            put(l, "gps")
        } else if let l = lastCoarse, now - lastCoarseAt < LocationEngine.coarseStaleMs, !dr.anchored || l.horizontalAccuracy <= dr.radius {
            put(l, "network")
        } else if dr.anchored {
            dr.tick(now)
            o["mode"] = "estimate"
            o["lat"] = dr.lat; o["lon"] = dr.lon; o["acc"] = dr.radius
            o["walked"] = dr.walked; o["time"] = now
        } else {
            o["mode"] = "none"
        }
        onUpdate?(o)
    }
}
