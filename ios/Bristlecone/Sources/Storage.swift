import Foundation

/// Settings, saved places and field reports on the device, plus backup and restore. The layout
/// under Application Support matches the Android app's files folder (kv/, tracks/, regions/,
/// cache/), and so does the backup zip.
final class Storage {
    let root: URL
    let kvDir: URL
    private let queue = DispatchQueue(label: "bristlecone.storage")

    init(root: URL) {
        self.root = root
        kvDir = root.appendingPathComponent("kv", isDirectory: true)
        try? FileManager.default.createDirectory(at: kvDir, withIntermediateDirectories: true)
    }

    static func safe(_ key: String) -> String {
        String(key.map { c -> Character in
            c.isASCII && (c.isLetter || c.isNumber || c == "_" || c == "." || c == "-") ? c : "_"
        })
    }

    private func file(_ key: String) -> URL { kvDir.appendingPathComponent(Storage.safe(key) + ".json") }

    /// Every stored value, handed to the page at startup so reads never wait on the bridge.
    func all() -> [String: String] {
        queue.sync {
            var out: [String: String] = [:]
            let names = (try? FileManager.default.contentsOfDirectory(atPath: kvDir.path)) ?? []
            for n in names where n.hasSuffix(".json") {
                if let s = try? String(contentsOf: kvDir.appendingPathComponent(n), encoding: .utf8) {
                    out[String(n.dropLast(5))] = s
                }
            }
            return out
        }
    }

    func put(_ key: String, _ value: String) {
        let f = file(key)
        queue.async { try? Data(value.utf8).write(to: f, options: .atomic) }
    }

    func remove(_ key: String) {
        let f = file(key)
        queue.async { try? FileManager.default.removeItem(at: f) }
    }

    func kvBytes() -> Int64 { Storage.folderBytes(kvDir) }

    static func folderBytes(_ dir: URL) -> Int64 {
        let fm = FileManager.default
        let names = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.reduce(Int64(0)) { sum, n in
            let a = try? fm.attributesOfItem(atPath: dir.appendingPathComponent(n).path)
            return sum + ((a?[.size] as? NSNumber)?.int64Value ?? 0)
        }
    }

    // MARK: Backup and restore

    /// Writes kv/ and tracks/ (and optionally regions/ and cache/) to a zip. Returns the file count.
    func backup(to url: URL, includeMaps: Bool) throws -> Int {
        try queue.sync {
            let w = try Zip.Writer(url: url)
            let created = Int64(Date().timeIntervalSince1970 * 1000)
            try w.add(name: "bristlecone-backup.txt", data: Data("Bristlecone backup\nformat=1\ncreated=\(created)\nmaps=\(includeMaps)\n".utf8))
            var n = 0
            var folders = ["kv", "tracks"]
            if includeMaps { folders += ["regions", "cache"] }
            let fm = FileManager.default
            for folder in folders {
                let dir = root.appendingPathComponent(folder, isDirectory: true)
                for name in ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).sorted() where !name.hasSuffix(".tmp") {
                    var isDir: ObjCBool = false
                    let f = dir.appendingPathComponent(name)
                    guard fm.fileExists(atPath: f.path, isDirectory: &isDir), !isDir.boolValue,
                          let d = try? Data(contentsOf: f) else { continue }
                    try w.add(name: folder + "/" + name, data: d)
                    n += 1
                }
            }
            try w.finish()
            return n
        }
    }

    /// Restores a backup zip. Only the known folders are written; anything else is ignored.
    func restore(from url: URL) throws -> Int {
        try queue.sync {
            let z = try Data(contentsOf: url, options: .mappedIfSafe)
            let entries = try Zip.entries(z)
            guard entries.contains(where: { $0.name == "bristlecone-backup.txt" }) else {
                throw Zip.Failure(message: "not a Bristlecone backup")
            }
            var n = 0
            let fm = FileManager.default
            for e in entries {
                let parts = e.name.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
                guard parts.count == 2, ["kv", "tracks", "regions", "cache"].contains(parts[0]),
                      !parts[1].isEmpty, !parts[1].contains(".."), !parts[1].hasPrefix(".") else { continue }
                let dir = root.appendingPathComponent(parts[0], isDirectory: true)
                try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
                try Zip.read(z, e).write(to: dir.appendingPathComponent(parts[1]), options: .atomic)
                n += 1
            }
            return n
        }
    }
}
