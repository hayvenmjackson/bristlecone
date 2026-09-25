import Foundation

/// Downloads a map region (tiles, terrain, trail data, land boundaries) so it works with no
/// signal. The page decides which URLs make up a region; this fetches them, pins them against
/// cache trimming and reports progress.
final class RegionManager {
    let dir: URL
    private let net: NetCache
    private let onProgress: ([String: Any]) -> Void
    private let queue = DispatchQueue(label: "bristlecone.regions")
    private var cancelled = Set<String>()
    private var active = Set<String>()

    init(root: URL, net: NetCache, onProgress: @escaping ([String: Any]) -> Void) {
        dir = root.appendingPathComponent("regions", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.net = net
        self.onProgress = onProgress
        refreshPins()
    }

    static func safe(_ id: String) -> String {
        String(id.map { c -> Character in c.isASCII && (c.isLetter || c.isNumber || c == "_" || c == "-") ? c : "_" })
    }

    private func file(_ id: String) -> URL { dir.appendingPathComponent(RegionManager.safe(id) + ".json") }

    func start(_ spec: [String: Any]) -> String {
        guard let id = spec["id"] as? String, let urls = spec["urls"] as? [String] else { return "error: bad region" }
        let manifest: [String: Any] = [
            "id": id, "name": spec["name"] as? String ?? "Region",
            "bbox": spec["bbox"] ?? NSNull(), "minZoom": spec["minZoom"] ?? 0, "maxZoom": spec["maxZoom"] ?? 0,
            "layers": spec["layers"] ?? [Any](), "created": Int64(NetCache.now()), "state": "downloading",
            "total": urls.count, "done": 0, "failed": 0, "bytes": 0,
            "keys": urls.map(CachePolicy.key)
        ]
        save(manifest)
        refreshPins()
        queue.sync { _ = active.insert(id); _ = cancelled.remove(id) }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            let slots = DispatchSemaphore(value: 4)
            let group = DispatchGroup()
            let counters = NSLock()
            var done = 0, failed = 0
            var bytes: Int64 = 0
            var lastReport = 0.0
            for url in urls {
                if self.isCancelled(id) { break }
                slots.wait()
                group.enter()
                let finishOne = { (ok: Bool, size: Int) in
                    counters.lock()
                    done += 1
                    if ok { bytes += Int64(size) } else { failed += 1 }
                    let d = done, f = failed, b = bytes
                    let now = NetCache.now()
                    let report = d == urls.count || now - lastReport > 400
                    if report { lastReport = now }
                    counters.unlock()
                    if report { self.report(manifest, done: d, failed: f, bytes: b, state: "downloading") }
                    slots.signal()
                    group.leave()
                }
                if self.net.isCachedFresh(url) { finishOne(true, 0); continue }
                self.net.get(url, forceNetwork: true) { r in
                    let ok = r.status == 200 || r.status == 204 || r.status == 404
                    // Be gentle with volunteer-run data services.
                    let delay: Double = url.contains("overpass") ? 1.2 : 0
                    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay) { finishOne(ok, r.body.count) }
                }
            }
            group.wait()
            let wasCancelled = self.isCancelled(id)
            counters.lock()
            let d = done, f = failed, b = bytes
            counters.unlock()
            self.report(manifest, done: d, failed: f, bytes: b, state: wasCancelled ? "cancelled" : (f > 0 ? "partial" : "ready"), finished: true)
            self.queue.sync { _ = self.active.remove(id) }
            if wasCancelled { self.delete(id) }
        }
        return "ok"
    }

    private func isCancelled(_ id: String) -> Bool { queue.sync { cancelled.contains(id) } }

    private func report(_ base: [String: Any], done: Int, failed: Int, bytes: Int64, state: String, finished: Bool = false) {
        var manifest = base
        manifest["done"] = done; manifest["failed"] = failed; manifest["bytes"] = bytes; manifest["state"] = state
        if finished { save(manifest) }
        onProgress(["id": manifest["id"] ?? "", "name": manifest["name"] ?? "", "done": done,
                    "total": manifest["total"] ?? 0, "failed": failed, "bytes": bytes, "state": state])
    }

    func cancel(_ id: String) { queue.sync { _ = cancelled.insert(id) } }

    func delete(_ id: String) {
        try? FileManager.default.removeItem(at: file(id))
        refreshPins()
        net.trim()
    }

    func list() -> [[String: Any]] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        let running = queue.sync { active }
        return names.compactMap { n -> [String: Any]? in
            guard var m = load(dir.appendingPathComponent(n)) else { return nil }
            m.removeValue(forKey: "keys")
            if let id = m["id"] as? String, running.contains(id) { m["state"] = "downloading" }
            else if m["state"] as? String == "downloading" { m["state"] = "partial" }
            return m
        }
    }

    func refreshPins() {
        var pins = Set<String>()
        for n in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] {
            if let keys = load(dir.appendingPathComponent(n))?["keys"] as? [String] { pins.formUnion(keys) }
        }
        net.pinned = pins
    }

    private func save(_ m: [String: Any]) {
        guard let id = m["id"] as? String, let d = try? JSONSerialization.data(withJSONObject: m) else { return }
        try? d.write(to: file(id), options: .atomic)
    }

    private func load(_ f: URL) -> [String: Any]? {
        guard f.pathExtension == "json", let d = try? Data(contentsOf: f) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }
}
