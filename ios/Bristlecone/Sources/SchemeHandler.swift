import Foundation
import WebKit

/// Serves the page from the app bundle at bristlecone://app/ and every remote request the page
/// makes at bristlecone://app/proxy/<host>/<path>, through the offline cache.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "bristlecone"
    static let appHost = "app.bristlecone.local"
    private static let proxyPrefix = "bristlecone://app/proxy/"

    private let net: NetCache
    private let web: URL
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()

    init(net: NetCache) {
        self.net = net
        self.web = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        let s = url.absoluteString
        if s.hasPrefix(SchemeHandler.proxyPrefix) {
            let rest = String(s.dropFirst(SchemeHandler.proxyPrefix.count))
            if rest.hasPrefix(SchemeHandler.appHost + "/") {
                serveAsset(String(rest.dropFirst(SchemeHandler.appHost.count)), task)
            } else {
                proxy("https://" + rest, task)
            }
        } else {
            serveAsset(url.path, task)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock(); stopped.insert(ObjectIdentifier(task as AnyObject)); lock.unlock()
    }

    // MARK: Bundled files

    private func serveAsset(_ rawPath: String, _ task: WKURLSchemeTask) {
        var path = rawPath.removingPercentEncoding ?? rawPath
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        if path.isEmpty || path == "/" { path = "/index.html" }
        if path.contains("..") { return finish(task, status: 404, type: "text/plain", body: Data()) }
        let file = web.appendingPathComponent(String(path.dropFirst()))
        if let d = try? Data(contentsOf: file) {
            return finish(task, status: 200, type: SchemeHandler.mime(path), body: d, extra: ["Cache-Control": "no-cache"])
        }
        // Overpass glyphs cover Latin, Greek and Cyrillic. Other ranges (for example Canadian
        // Aboriginal syllabics) fall back to OpenFreeMap's Noto Sans in the matching weight.
        let parts = path.split(separator: "/").map(String.init)
        if parts.count == 3, parts[0] == "glyphs", parts[2].range(of: "^\\d+-\\d+\\.pbf$", options: .regularExpression) != nil {
            let stack = parts[1].contains("Bold") ? "Noto%20Sans%20Bold" : parts[1].contains("Italic") ? "Noto%20Sans%20Italic" : "Noto%20Sans%20Regular"
            return proxy("https://tiles.openfreemap.org/fonts/" + stack + "/" + parts[2], task)
        }
        finish(task, status: 404, type: "text/plain", body: Data())
    }

    // MARK: Remote, through the cache

    private func proxy(_ url: String, _ task: WKURLSchemeTask) {
        net.get(url) { [weak self] r in
            DispatchQueue.main.async {
                var status = r.status <= 0 ? 504 : r.status
                if status < 200 || (status >= 300 && status < 400) { status = 502 }
                self?.finish(task, status: status, type: r.contentType, body: r.body, extra: [
                    "Access-Control-Expose-Headers": "X-Bc-Fetched, X-Bc-Stale",
                    "X-Bc-Fetched": String(Int64(r.fetchedAt)),
                    "X-Bc-Stale": r.stale ? "1" : "0",
                    "Cache-Control": "no-store"
                ])
            }
        }
    }

    private func finish(_ task: WKURLSchemeTask, status: Int, type: String, body: Data, extra: [String: String] = [:]) {
        let run = { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            let wasStopped = self.stopped.remove(ObjectIdentifier(task as AnyObject)) != nil
            self.lock.unlock()
            if wasStopped { return }
            var headers = extra
            headers["Content-Type"] = type
            headers["Content-Length"] = String(body.count)
            headers["Access-Control-Allow-Origin"] = "*"
            guard let url = task.request.url,
                  let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
            task.didReceive(resp)
            task.didReceive(body)
            task.didFinish()
        }
        if Thread.isMainThread { run() } else { DispatchQueue.main.async(execute: run) }
    }

    static func mime(_ path: String) -> String {
        let p = path.lowercased()
        if p.hasSuffix(".html") { return "text/html; charset=utf-8" }
        if p.hasSuffix(".js") { return "application/javascript; charset=utf-8" }
        if p.hasSuffix(".css") { return "text/css; charset=utf-8" }
        if p.hasSuffix(".json") { return "application/json" }
        if p.hasSuffix(".svg") { return "image/svg+xml" }
        if p.hasSuffix(".png") { return "image/png" }
        if p.hasSuffix(".woff2") { return "font/woff2" }
        if p.hasSuffix(".pbf") { return "application/x-protobuf" }
        return "application/octet-stream"
    }
}
