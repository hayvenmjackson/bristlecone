import Foundation
import Network
import CryptoKit

/// How each remote request is cached. Same rules and cache keys as the Android app, so a backup
/// with downloaded maps restores on either platform.
///
///  tile : map tiles, glyphs, TileJSON. Served from disk if younger than 30 days.
///  data : trail geometry, land boundaries, geocoding. Served from disk if younger than 7 days.
///  live : trail reports, weather alerts, avalanche forecasts. Always fetched fresh when online;
///         the last copy is used only when offline, and the UI labels it with its age.
enum CachePolicy {
    enum Kind { case tile, data, live }

    static let day: Double = 24 * 3600 * 1000

    static func classify(_ url: String) -> Kind {
        let u = url.lowercased()
        let h = host(u)
        if h == "api.weather.gov" || h == "api.weather.gc.ca"
            || (h == "developer.nps.gov" && u.contains("/alerts"))
            || h == "api.avalanche.org" || h == "api.avalanche.ca"
            || h == "api.openstreetmap.org" || u.contains("wfigs")
            || u.contains("/api/v1/timelines/tag/") {
            return .live
        }
        if h == "tiles.openfreemap.org" || h.contains("elevation-tiles-prod")
            || u.contains("/elevation-tiles-prod/") || h == "basemap.nationalmap.gov"
            || h.hasSuffix("tile.opentopomap.org") || u.contains("/mapserver/tile/")
            || u.contains("/fonts/") || u.hasSuffix(".pbf") || u.hasSuffix(".mvt")
            || u.hasSuffix(".png") || u.hasSuffix(".jpg") || u.hasSuffix(".jpeg") || u.hasSuffix(".webp") {
            return .tile
        }
        return .data
    }

    static func ttl(_ k: Kind) -> Double {
        switch k {
        case .tile: return 30 * day
        case .data: return 7 * day
        case .live: return 0
        }
    }

    /// OpenFreeMap tile paths carry a build version (/planet/20260915_001001_pt/12/...). It is
    /// dropped from the key so downloaded regions keep working after the server moves on.
    static func cacheKeyUrl(_ url: String) -> String {
        guard let re = try? NSRegularExpression(pattern: "(tiles\\.openfreemap\\.org/[a-z]+)/\\d{8}_\\d{6}_pt/") else { return url }
        let range = NSRange(url.startIndex..., in: url)
        guard let m = re.firstMatch(in: url, range: range) else { return url }
        let replacement = re.replacementString(for: m, in: url, offset: 0, template: "$1/_/")
        return (url as NSString).replacingCharacters(in: m.range, with: replacement)
    }

    static func key(_ url: String) -> String {
        let digest = Insecure.SHA1.hash(data: Data(cacheKeyUrl(url).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func host(_ u: String) -> String {
        guard let s = u.range(of: "://") else { return "" }
        let rest = u[s.upperBound...]
        let h = rest.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return h.split(separator: ":").first.map(String.init) ?? h
    }
}

/// Local-first network layer. Every request the map and the page make goes through here, so
/// tiles, trail data and reports are stored on the device and keep working with no signal.
final class NetCache {
    static let userAgent = "Bristlecone/1.2 (iOS trail map; public-data client)"
    private static let browseCacheCap: Int64 = 700 * 1024 * 1024

    struct Result {
        var status = 504
        var contentType = "application/octet-stream"
        var body = Data()
        var fetchedAt: Double = 0
        var stale = false
    }

    let dir: URL
    private let session: URLSession
    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var pinnedKeys = Set<String>()
    private(set) var online = true

    init(root: URL) {
        dir = root.appendingPathComponent("cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let cfg = URLSessionConfiguration.default
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.urlCache = nil
        cfg.timeoutIntervalForRequest = 25
        cfg.httpMaximumConnectionsPerHost = 6
        cfg.httpAdditionalHeaders = ["User-Agent": NetCache.userAgent]
        session = URLSession(configuration: cfg)
        monitor.pathUpdateHandler = { [weak self] p in self?.online = p.status == .satisfied }
        monitor.start(queue: DispatchQueue(label: "bristlecone.net.monitor"))
    }

    var pinned: Set<String> {
        get { lock.lock(); defer { lock.unlock() }; return pinnedKeys }
        set { lock.lock(); pinnedKeys = newValue; lock.unlock() }
    }

    static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

    /// Fetch with the cache policy for this URL. forceNetwork is used by the region downloader.
    func get(_ url: String, forceNetwork: Bool = false, completion: @escaping (Result) -> Void) {
        let kind = CachePolicy.classify(url)
        let key = CachePolicy.key(url)
        let body = dir.appendingPathComponent(key + ".bin")
        let meta = dir.appendingPathComponent(key + ".meta")
        let cached = readCached(body: body, meta: meta)
        let t = NetCache.now()
        if !forceNetwork, var c = cached, t - c.fetchedAt < CachePolicy.ttl(kind) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: body.path)
            c.stale = false
            completion(c)
            return
        }
        if !online, var c = cached {
            c.stale = true
            completion(c)
            return
        }
        guard let u = URL(string: url) else {
            completion(Result(status: 400, contentType: "text/plain", body: Data("bad url".utf8), fetchedAt: t))
            return
        }
        var req = URLRequest(url: u)
        req.timeoutInterval = url.contains("overpass") ? 95 : 25
        req.setValue(url.contains("api.weather.gov") ? "application/geo+json" : "*/*", forHTTPHeaderField: "Accept")
        session.dataTask(with: req) { [weak self] data, response, error in
            guard let self = self else { return }
            guard let http = response as? HTTPURLResponse, error == nil else {
                if var c = cached { c.stale = true; completion(c); return }
                completion(Result(status: 504, contentType: "text/plain", body: Data("offline".utf8), fetchedAt: NetCache.now()))
                return
            }
            var r = Result()
            r.status = http.statusCode
            r.contentType = http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
            r.body = data ?? Data()
            r.fetchedAt = NetCache.now()
            let cacheable = r.status == 200 || (kind == .tile && (r.status == 204 || r.status == 404))
            if cacheable {
                self.write(body: body, meta: meta, url: url, r)
            } else if var c = cached {
                c.stale = true
                completion(c)
                return
            }
            completion(r)
        }.resume()
    }

    func isCachedFresh(_ url: String) -> Bool {
        let key = CachePolicy.key(url)
        let meta = dir.appendingPathComponent(key + ".meta")
        guard let d = try? Data(contentsOf: meta),
              let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
        let t = (m["t"] as? NSNumber)?.doubleValue ?? 0
        return NetCache.now() - t < CachePolicy.ttl(CachePolicy.classify(url))
            && FileManager.default.fileExists(atPath: dir.appendingPathComponent(key + ".bin").path)
    }

    // MARK: Disk

    private func readCached(body: URL, meta: URL) -> Result? {
        guard let md = try? Data(contentsOf: meta),
              let m = try? JSONSerialization.jsonObject(with: md) as? [String: Any],
              let b = try? Data(contentsOf: body) else { return nil }
        var r = Result()
        r.status = (m["status"] as? NSNumber)?.intValue ?? 200
        r.contentType = m["type"] as? String ?? "application/octet-stream"
        r.fetchedAt = (m["t"] as? NSNumber)?.doubleValue ?? 0
        r.body = b
        return r
    }

    private func write(body: URL, meta: URL, url: String, _ r: Result) {
        let tmp = dir.appendingPathComponent(body.lastPathComponent + "." + UUID().uuidString + ".tmp")
        do {
            try r.body.write(to: tmp)
            let m: [String: Any] = ["url": url, "status": r.status, "type": r.contentType, "t": r.fetchedAt]
            try JSONSerialization.data(withJSONObject: m).write(to: meta, options: .atomic)
            _ = try? FileManager.default.removeItem(at: body)
            try FileManager.default.moveItem(at: tmp, to: body)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
        }
    }

    // MARK: Maintenance

    func sizeBytes() -> Int64 {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return 0 }
        var total: Int64 = 0
        for n in names {
            if let a = try? fm.attributesOfItem(atPath: dir.appendingPathComponent(n).path), let s = a[.size] as? NSNumber { total += s.int64Value }
        }
        return total
    }

    /// Trims the browsing cache. Files that belong to a downloaded region are never removed.
    func trim() {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
        let pins = pinned
        var bins: [(url: URL, size: Int64, date: Date, key: String)] = []
        var total: Int64 = 0
        for n in names {
            let u = dir.appendingPathComponent(n)
            if n.hasSuffix(".tmp") { try? fm.removeItem(at: u); continue }
            guard n.hasSuffix(".bin") else { continue }
            let key = String(n.dropLast(4))
            if pins.contains(key) { continue }
            let a = try? fm.attributesOfItem(atPath: u.path)
            let size = (a?[.size] as? NSNumber)?.int64Value ?? 0
            bins.append((u, size, a?[.modificationDate] as? Date ?? .distantPast, key))
            total += size
        }
        if total <= NetCache.browseCacheCap { return }
        for f in bins.sorted(by: { $0.date < $1.date }) {
            if total <= NetCache.browseCacheCap * 8 / 10 { break }
            total -= f.size
            try? fm.removeItem(at: f.url)
            try? fm.removeItem(at: dir.appendingPathComponent(f.key + ".meta"))
        }
    }

    func clearUnpinned() {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
        let pins = pinned
        for n in names {
            let key = n.split(separator: ".").first.map(String.init) ?? n
            if !pins.contains(key) { try? fm.removeItem(at: dir.appendingPathComponent(n)) }
        }
    }
}
