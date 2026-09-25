import Foundation
import CoreLocation
import CoreMotion

/// Running statistics for a recorded hike, the same rules as on Android: GPS jitter is filtered,
/// moving time only counts real movement, and climb uses the barometer when there is one, with
/// a hysteresis band so small wobbles do not add up to phantom climbing.
final class TrackStats {
    static let maxAccuracy = 40.0
    private static let baroBand = 3.0
    private static let gpsBand = 10.0
    private static let minMovingSpeed = 0.3
    private static let maxGapMs = 60_000.0

    private var has = false
    private var lastLat = 0.0, lastLon = 0.0, lastT = 0.0
    private(set) var startTime = 0.0, endTime = 0.0
    private(set) var distance = 0.0
    private var moving = 0.0
    private(set) var points = 0
    private var baroRef = Double.nan, gpsRef = Double.nan
    private var baroGain = 0.0, baroLoss = 0.0, gpsGain = 0.0, gpsLoss = 0.0
    private(set) var usedBarometer = false
    private var gpsWin = [Double](repeating: 0, count: 5)
    private var gpsN = 0
    private(set) var maxAltitude = Double.nan, minAltitude = Double.nan

    /// Returns true if the point was kept (and should be written to the track).
    @discardableResult
    func add(t: Double, lat: Double, lon: Double, acc: Double, gpsAlt: Double, baroAlt: Double) -> Bool {
        if acc > TrackStats.maxAccuracy || lat.isNaN || lon.isNaN { return false }
        if !has {
            has = true; startTime = t; endTime = t; lastT = t; lastLat = lat; lastLon = lon; points = 1
            elevation(gpsAlt, baroAlt)
            return true
        }
        let d = DeadReckoner.distance(lastLat, lastLon, lat, lon)
        if d < max(3.0, acc * 0.6) { endTime = max(endTime, t); elevation(gpsAlt, baroAlt); return false }
        let dt = t - lastT
        if dt > 0 && dt <= TrackStats.maxGapMs && d / (dt / 1000) >= TrackStats.minMovingSpeed { moving += dt }
        distance += d
        lastLat = lat; lastLon = lon; lastT = t; endTime = t; points += 1
        elevation(gpsAlt, baroAlt)
        return true
    }

    private func elevation(_ gpsAlt: Double, _ baroAlt: Double) {
        if !baroAlt.isNaN {
            usedBarometer = true
            if baroRef.isNaN { baroRef = baroAlt }
            else if baroAlt - baroRef >= TrackStats.baroBand { baroGain += baroAlt - baroRef; baroRef = baroAlt }
            else if baroRef - baroAlt >= TrackStats.baroBand { baroLoss += baroRef - baroAlt; baroRef = baroAlt }
        }
        if !gpsAlt.isNaN {
            // Average the last five GPS altitudes before applying the band; single fixes wander.
            gpsWin[gpsN % gpsWin.count] = gpsAlt
            gpsN += 1
            let n = min(gpsN, gpsWin.count)
            let avg = gpsWin[0..<n].reduce(0, +) / Double(n)
            if gpsRef.isNaN { gpsRef = avg }
            else if avg - gpsRef >= TrackStats.gpsBand { gpsGain += avg - gpsRef; gpsRef = avg }
            else if gpsRef - avg >= TrackStats.gpsBand { gpsLoss += gpsRef - avg; gpsRef = avg }
            maxAltitude = maxAltitude.isNaN ? gpsAlt : max(maxAltitude, gpsAlt)
            minAltitude = minAltitude.isNaN ? gpsAlt : min(minAltitude, gpsAlt)
        }
    }

    var gain: Double { usedBarometer ? baroGain : gpsGain }
    var loss: Double { usedBarometer ? baroLoss : gpsLoss }
    var movingMs: Double { moving }
    var elapsedMs: Double { has ? endTime - startTime : 0 }
}

/// Recorded hikes on disk: tracks/ID.json (summary) and ID.csv (time, lat, lon, accuracy, GPS
/// altitude, barometric altitude per line). The same files as on Android.
final class TrackStore {
    let dir: URL
    private let queue = DispatchQueue(label: "bristlecone.tracks")

    init(root: URL) {
        dir = root.appendingPathComponent("tracks", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    static func safe(_ id: String) -> String {
        String(id.map { c -> Character in c.isASCII && (c.isLetter || c.isNumber || c == "_" || c == "-") ? c : "_" })
    }
    func pointsFile(_ id: String) -> URL { dir.appendingPathComponent(TrackStore.safe(id) + ".csv") }
    func metaFile(_ id: String) -> URL { dir.appendingPathComponent(TrackStore.safe(id) + ".json") }

    func append(_ id: String, t: Double, lat: Double, lon: Double, acc: Double, alt: Double, baro: Double) {
        let f = pointsFile(id)
        let line = String(format: "%lld,%.6f,%.6f,%.1f,%@,%@\n", Int64(t), lat, lon, acc,
                          alt.isNaN ? "" : String(format: "%.1f", alt), baro.isNaN ? "" : String(format: "%.1f", baro))
        queue.sync {
            if !FileManager.default.fileExists(atPath: f.path) { FileManager.default.createFile(atPath: f.path, contents: nil) }
            guard let h = try? FileHandle(forWritingTo: f) else { return }
            h.seekToEndOfFile()
            h.write(Data(line.utf8))
            try? h.close()
        }
    }

    func writeMeta(_ m: [String: Any]) {
        guard let id = m["id"] as? String, let d = try? JSONSerialization.data(withJSONObject: m) else { return }
        queue.sync { try? d.write(to: metaFile(id), options: .atomic) }
    }

    func readMeta(_ id: String) -> [String: Any]? {
        queue.sync {
            guard let d = try? Data(contentsOf: metaFile(id)) else { return nil }
            return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
        }
    }

    func list() -> [[String: Any]] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { $0.hasSuffix(".json") }.compactMap { readMeta(String($0.dropLast(5))) }
    }

    /// Points as [[lon, lat, timeMs, altitude or null], ...].
    func readPoints(_ id: String) -> [[Any]] {
        queue.sync {
            guard let s = try? String(contentsOf: pointsFile(id), encoding: .utf8) else { return [] }
            return s.split(separator: "\n").compactMap { line -> [Any]? in
                let a = line.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
                guard a.count >= 6, let t = Double(a[0]), let lat = Double(a[1]), let lon = Double(a[2]) else { return nil }
                return [lon, lat, t, Double(a[4]).map { $0 as Any } ?? NSNull()]
            }
        }
    }

    /// Full fixes for Apple Health's route: (time, lat, lon, accuracy, altitude).
    func readFixes(_ id: String) -> [(Double, Double, Double, Double, Double)] {
        queue.sync {
            guard let s = try? String(contentsOf: pointsFile(id), encoding: .utf8) else { return [] }
            return s.split(separator: "\n").compactMap { line -> (Double, Double, Double, Double, Double)? in
                let a = line.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
                guard a.count >= 6, let t = Double(a[0]), let lat = Double(a[1]), let lon = Double(a[2]) else { return nil }
                return (t, lat, lon, Double(a[3]) ?? 10, Double(a[4]) ?? Double.nan)
            }
        }
    }

    func delete(_ id: String) {
        queue.sync {
            try? FileManager.default.removeItem(at: pointsFile(id))
            try? FileManager.default.removeItem(at: metaFile(id))
        }
    }
}

/// Records a hike with the screen locked. iOS keeps location updates coming to an app that
/// asked for them in the foreground and declared background location; the blue indicator in
/// the status bar shows it is happening.
final class TrackRecorder: NSObject, CLLocationManagerDelegate {
    private let store: TrackStore
    private let manager = CLLocationManager()
    private let pedometer = CMPedometer()
    private let altimeter = CMAltimeter()
    private var baroAlt = Double.nan
    private var stepsAtPause = 0, stepsBase = 0, pedTotal = 0

    private(set) var currentId: String?
    private(set) var paused = false
    private(set) var stats: TrackStats?
    private(set) var steps = 0

    init(store: TrackStore) {
        self.store = store
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 2
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start() {
        guard currentId == nil else { return }
        let id = "t" + String(Int64(NetCache.now()))
        currentId = id
        stats = TrackStats()
        steps = 0
        paused = false
        UserDefaults.standard.set(id, forKey: "recording")
        listen()
    }

    /// If iOS ended the app mid-hike, carry on with the same recording: replay the points already
    /// on disk into fresh statistics and keep listening.
    func recover() {
        guard currentId == nil, let id = UserDefaults.standard.string(forKey: "recording"),
              FileManager.default.fileExists(atPath: store.pointsFile(id).path) else { return }
        let s = TrackStats()
        for f in store.readFixes(id) { s.add(t: f.0, lat: f.1, lon: f.2, acc: 5, gpsAlt: f.4, baroAlt: .nan) }
        stats = s
        currentId = id
        paused = false
        listen()
    }

    func pause() { paused = true; stepsAtPause = pedTotal }
    func resume() { paused = false; stepsBase += pedTotal - stepsAtPause }

    /// Stops and writes the summary. Returns the hike id.
    func stop() -> String {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        pedometer.stopUpdates()
        altimeter.stopRelativeAltitudeUpdates()
        let id = currentId ?? ""
        if let s = stats, !id.isEmpty {
            if s.points > 1 { store.writeMeta(TrackRecorder.summary(id: id, s, steps: steps)) } else { store.delete(id) }
        }
        currentId = nil
        UserDefaults.standard.removeObject(forKey: "recording")
        return id
    }

    private func listen() {
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        pedTotal = 0; stepsBase = 0; stepsAtPause = 0
        if CMPedometer.isStepCountingAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] d, _ in
                guard let d = d else { return }
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.pedTotal = d.numberOfSteps.intValue
                    if !self.paused { self.steps = max(self.steps, self.pedTotal - self.stepsBase) }
                }
            }
        }
        if CMAltimeter.isRelativeAltitudeAvailable() {
            // Relative altitude is enough for climb: only differences are counted.
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] d, _ in
                guard let self = self, let a = d?.relativeAltitude.doubleValue else { return }
                self.baroAlt = self.baroAlt.isNaN ? a : 0.8 * self.baroAlt + 0.2 * a
            }
        }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard !paused, let id = currentId, let s = stats else { return }
        for l in locs where l.horizontalAccuracy >= 0 {
            let t = l.timestamp.timeIntervalSince1970 * 1000
            let alt = l.verticalAccuracy >= 0 ? l.altitude : Double.nan
            if s.add(t: t, lat: l.coordinate.latitude, lon: l.coordinate.longitude, acc: l.horizontalAccuracy, gpsAlt: alt, baroAlt: baroAlt) {
                store.append(id, t: t, lat: l.coordinate.latitude, lon: l.coordinate.longitude, acc: l.horizontalAccuracy, alt: alt, baro: baroAlt)
            }
        }
    }

    func status() -> [String: Any] {
        guard let id = currentId, let s = stats else { return ["recording": false] }
        return ["recording": true, "id": id, "paused": paused, "distance": s.distance, "gain": s.gain,
                "movingMs": s.movingMs, "elapsedMs": NetCache.now() - (s.startTime > 0 ? s.startTime : NetCache.now()),
                "points": s.points, "steps": steps]
    }

    static func summary(id: String, _ s: TrackStats, steps: Int) -> [String: Any] {
        ["id": id, "name": NSNull(), "start": s.startTime, "end": s.endTime, "distance": s.distance,
         "gain": s.gain, "loss": s.loss, "barometer": s.usedBarometer, "movingMs": s.movingMs,
         "elapsedMs": s.elapsedMs, "points": s.points, "steps": steps,
         "maxAlt": s.maxAltitude.isNaN ? NSNull() as Any : s.maxAltitude, "healthSynced": false]
    }
}
