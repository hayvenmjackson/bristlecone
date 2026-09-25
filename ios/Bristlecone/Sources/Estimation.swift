import Foundation

/// Learned step length for position estimates when GPS drops out. Same model as the Android
/// app: step length is a linear function of cadence and climb rate, fitted with recursive least
/// squares every time a clean stretch of GPS gives a measured distance for a known step count.
final class StrideModel {
    static let n = 3
    private static let lambda = 0.995
    private static let minStep = 0.30
    private static let maxStep = 1.30

    private var w = [Double](repeating: 0, count: StrideModel.n)
    private var p = [[Double]](repeating: [Double](repeating: 0, count: StrideModel.n), count: StrideModel.n)
    private(set) var samples = 0

    init() { reset() }

    func reset() {
        // About 0.70 m per step at 1.8 steps/s on flat ground, shorter steps when climbing.
        w = [0.30, 0.22, -0.35]
        for i in 0..<StrideModel.n { for j in 0..<StrideModel.n { p[i][j] = i == j ? 0.05 : 0 } }
        samples = 0
    }

    static func features(cadence: Double, verticalSpeed: Double) -> [Double] {
        [1.0, clamp(cadence, 0.2, 3.5), min(abs(verticalSpeed), 1.5)]
    }

    func predict(cadence: Double, verticalSpeed: Double) -> Double {
        let x = StrideModel.features(cadence: cadence, verticalSpeed: verticalSpeed)
        var y = 0.0
        for i in 0..<StrideModel.n { y += w[i] * x[i] }
        return StrideModel.clamp(y, StrideModel.minStep, StrideModel.maxStep)
    }

    @discardableResult
    func update(cadence: Double, verticalSpeed: Double, observedStep: Double) -> Bool {
        if observedStep.isNaN || observedStep < StrideModel.minStep || observedStep > StrideModel.maxStep { return false }
        let n = StrideModel.n
        let x = StrideModel.features(cadence: cadence, verticalSpeed: verticalSpeed)
        var px = [Double](repeating: 0, count: n)
        for i in 0..<n { for j in 0..<n { px[i] += p[i][j] * x[j] } }
        var denom = StrideModel.lambda
        for i in 0..<n { denom += x[i] * px[i] }
        let k = px.map { $0 / denom }
        var err = observedStep
        for i in 0..<n { err -= w[i] * x[i] }
        for i in 0..<n { w[i] += k[i] * err }
        var np = p
        for i in 0..<n { for j in 0..<n { np[i][j] = (p[i][j] - k[i] * px[j]) / StrideModel.lambda } }
        for i in 0..<n { for j in 0..<n { p[i][j] = 0.5 * (np[i][j] + np[j][i]) } }
        for i in 0..<n where p[i][i] > 1.0 { p[i][i] = 1.0 }
        samples += 1
        return true
    }

    /// 0...1, used to scale the uncertainty radius.
    var confidence: Double { min(1.0, Double(samples) / 40.0) }

    /// Same text format as Android, so the learned model survives a cross-platform restore.
    func serialize() -> String {
        ([String(samples)] + w.map { String($0) } + p.flatMap { $0.map { String($0) } }).joined(separator: ",")
    }

    func deserialize(_ s: String?) {
        guard let s = s, !s.isEmpty else { return }
        let a = s.split(separator: ",").map(String.init)
        let n = StrideModel.n
        guard a.count == 1 + n + n * n, let smp = Int(a[0]) else { return }
        let nums = a.dropFirst().compactMap { Double($0) }
        guard nums.count == n + n * n else { reset(); return }
        w = Array(nums[0..<n])
        for i in 0..<n { for j in 0..<n { p[i][j] = nums[n + i * n + j] } }
        samples = smp
    }

    static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { v < lo ? lo : (v > hi ? hi : v) }
}

/// Position estimate when GPS is unavailable: starts from the last trustworthy fix, advances
/// along the compass heading with the learned stride, and grows an honest uncertainty radius.
final class DeadReckoner {
    private static let earthR = 6_371_008.8
    private static let growthPerMTrained = 0.12
    private static let growthPerMPrior = 0.22
    private static let growthPerS = 0.15
    static let maxRadius = 5000.0

    private(set) var anchored = false
    private(set) var lat = 0.0, lon = 0.0, radius = 0.0, walked = 0.0
    private var lastMs = 0.0

    func anchor(lat: Double, lon: Double, accuracy: Double, timeMs: Double) {
        self.lat = lat; self.lon = lon
        radius = max(accuracy, 5)
        lastMs = timeMs
        walked = 0
        anchored = true
    }

    /// Advances by one or more steps. heading is degrees clockwise from true north.
    func step(metres: Double, heading: Double, confidence: Double, timeMs: Double) {
        guard anchored else { return }
        tick(timeMs)
        (lat, lon) = DeadReckoner.offset(lat: lat, lon: lon, dist: metres, bearing: heading)
        walked += metres
        let g = DeadReckoner.growthPerMPrior + (DeadReckoner.growthPerMTrained - DeadReckoner.growthPerMPrior) * confidence
        radius = min(DeadReckoner.maxRadius, radius + g * metres)
    }

    func tick(_ timeMs: Double) {
        guard anchored, timeMs > lastMs else { return }
        radius = min(DeadReckoner.maxRadius, radius + DeadReckoner.growthPerS * (timeMs - lastMs) / 1000)
        lastMs = timeMs
    }

    static func offset(lat: Double, lon: Double, dist: Double, bearing: Double) -> (Double, Double) {
        let d = dist / earthR, b = bearing * .pi / 180
        let p1 = lat * .pi / 180, l1 = lon * .pi / 180
        let p2 = asin(sin(p1) * cos(d) + cos(p1) * sin(d) * cos(b))
        let l2 = l1 + atan2(sin(b) * sin(d) * cos(p1), cos(d) - sin(p1) * sin(p2))
        return (p2 * 180 / .pi, (l2 * 180 / .pi + 540).truncatingRemainder(dividingBy: 360) - 180)
    }

    static func distance(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = p2 - p1, dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * earthR * asin(min(1, a.squareRoot()))
    }
}
