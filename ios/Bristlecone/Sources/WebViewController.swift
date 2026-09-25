import UIKit
import WebKit
import MessageUI
import UniformTypeIdentifiers

/// Hosts the shared map UI (the same web layer as the Android app) and answers its calls.
/// The page posts {m: method, a: [args]} to the "bc" handler and gets a Promise back; events
/// flow the other way through window.bcNative, exactly as on Android.
final class WebViewController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate,
                                UIDocumentPickerDelegate, MFMessageComposeViewControllerDelegate {
    static let version = "1.2.0"

    private var web: WKWebView!
    private let root: URL
    private let net: NetCache
    private let storage: Storage
    private let tracks: TrackStore
    private let recorder: TrackRecorder
    private let location = LocationEngine()
    private let health = HealthSync()
    private var regions: RegionManager!
    private let io = DispatchQueue(label: "bristlecone.io", qos: .userInitiated)

    private var wantLocation = false
    private var pendingRecording = false
    private var dark = false
    private enum PickerJob { case backup(Int), restore, export }
    private var pickerJob: PickerJob?

    init() {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Bristlecone", isDirectory: true)
        try? fm.createDirectory(at: base, withIntermediateDirectories: true)
        let n = NetCache(root: base)
        // Map tiles can be re-downloaded, so they stay out of iCloud device backups.
        var cacheDir = n.dir
        var rv = URLResourceValues()
        rv.isExcludedFromBackup = true
        try? cacheDir.setResourceValues(rv)
        let t = TrackStore(root: base)
        root = base
        net = n
        storage = Storage(root: base)
        tracks = t
        recorder = TrackRecorder(store: t)
        super.init(nibName: nil, bundle: nil)
        regions = RegionManager(root: root, net: net) { [weak self] s in
            DispatchQueue.main.async { self?.callJs("onRegionProgress", s) }
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override var preferredStatusBarStyle: UIStatusBarStyle { dark ? .lightContent : .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        let paper = UIColor(red: 0xF6 / 255, green: 0xF3 / 255, blue: 0xEA / 255, alpha: 1)
        view.backgroundColor = paper

        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(net: net), forURLScheme: SchemeHandler.scheme)
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "bc")
        cfg.allowsInlineMediaPlayback = true
        cfg.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = paper
        web.scrollView.backgroundColor = paper
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)
        refreshStartupScript()
        web.load(URLRequest(url: URL(string: "bristlecone://app/index.html")!))

        location.onUpdate = { [weak self] fix in self?.callJs("onLocation", fix) }
        location.onAuthorization = { [weak self] in self?.authorizationChanged() }
        recorder.recover()

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func didBecomeActive() {
        if wantLocation && location.authorized { location.start() }
        refreshInfo()
        callJs("onResume", [String: Any]())
    }

    @objc private func didEnterBackground() {
        location.stop()
        io.async { [net] in net.trim() }
    }

    // MARK: Startup data for the page

    private func info() -> [String: Any] {
        [
            "platform": "ios",
            "idiom": UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone",
            "locale": Locale.preferredLanguages.first ?? "en-US",
            "version": WebViewController.version,
            "health": health.available,
            "healthGranted": health.granted,
            "openedFor": NSNull(),
            "os": UIDevice.current.systemVersion,
            "barometer": location.hasBarometer,
            "stepDetector": location.hasStepCounter,
            "locationPermission": location.authorized,
            "online": net.online,
            "strideSamples": location.strideSamples,
            "strideAt18": location.strideAt(1.8)
        ]
    }

    /// Settings and saved places are handed to the page before it starts, so reads never wait.
    /// Rebuilt before every page load (a restore reloads the page).
    private func refreshStartupScript() {
        let js = "window.BC_INFO = \(json(info()));\nwindow.BC_KV = \(json(storage.all()));\nwindow.BC_PROXY = 'bristlecone://app/proxy/';"
        let ucc = web.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func refreshInfo() {
        web?.evaluateJavaScript("window.BC_INFO = \(json(info()));", completionHandler: nil)
    }

    // MARK: Calls from the page

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let m = body["m"] as? String else { replyHandler(nil, "bad call"); return }
        let a = body["a"] as? [Any] ?? []
        func s(_ i: Int) -> String { i < a.count ? (a[i] as? String ?? (a[i] as? NSNumber)?.stringValue ?? "") : "" }
        func b(_ i: Int) -> Bool { i < a.count ? ((a[i] as? NSNumber)?.boolValue ?? false) : false }
        let reply = { (v: Any?) in replyHandler(v ?? NSNull(), nil) }
        let later = { (work: @escaping () -> Any?) in
            self.io.async { let v = work(); DispatchQueue.main.async { reply(v) } }
        }

        switch m {
        // Storage
        case "kvPut": storage.put(s(0), s(1)); reply(true)
        case "kvRemove": storage.remove(s(0)); reply(nil)

        // Location
        case "requestLocation": wantLocation = true; location.request(); reply(nil)
        case "stopLocation": wantLocation = false; location.stop(); reply(nil)
        case "resetStride": location.resetStride(); reply(nil)

        // Offline regions
        case "downloadRegion":
            guard let d = s(0).data(using: .utf8), let spec = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { reply("error: bad region"); return }
            reply(regions.start(spec))
        case "cancelRegion": regions.cancel(s(0)); reply(nil)
        case "deleteRegion": let id = s(0); later { self.regions.delete(id); return nil }
        case "listRegions": later { self.json(self.regions.list()) }
        case "storageStats":
            later {
                let free = (try? self.root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage ?? 0
                return self.json(["cacheBytes": self.net.sizeBytes(), "dataBytes": self.storage.kvBytes() + Storage.folderBytes(self.tracks.dir), "freeBytes": free])
            }
        case "clearBrowseCache": later { self.net.clearUnpinned(); return nil }

        // Files
        case "backup": startBackup(includeMaps: b(0), filename: s(1)); reply(nil)
        case "restore": startRestore(); reply(nil)
        case "saveFile": startExport(filename: s(0), base64: s(2)); reply(nil)

        // System
        case "openExternal": openExternal(s(0)); reply(nil)
        case "setDark": dark = b(0); setNeedsStatusBarAppearanceUpdate(); reply(nil)
        case "keepScreenOn": UIApplication.shared.isIdleTimerDisabled = b(0); reply(nil)
        case "copy": UIPasteboard.general.string = s(0); reply(nil)
        case "share": presentShare([s(0)]); reply(nil)
        case "sms": sms(s(0)); reply(nil)

        // Recording
        case "trackStart": startRecording(); reply(nil)
        case "trackPause": recorder.pause(); reply(nil)
        case "trackResume": recorder.resume(); reply(nil)
        case "trackStop": reply(recorder.stop())
        case "trackStatus": reply(json(recorder.status()))
        case "trackList": later { self.json(self.tracks.list()) }
        case "trackPoints": let id = s(0); later { self.json(self.tracks.readPoints(id)) }
        case "trackMeta": let id = s(0); later { self.tracks.readMeta(id).map { self.json($0) } ?? "null" }
        case "trackDelete": let id = s(0); later { self.tracks.delete(id); return nil }
        case "trackUpdate":
            let upd = s(0)
            later {
                guard let d = upd.data(using: .utf8), let u = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                      let id = u["id"] as? String, var meta = self.tracks.readMeta(id) else { return false }
                for k in ["name", "healthSynced", "demGain"] where u[k] != nil { meta[k] = u[k] }
                self.tracks.writeMeta(meta)
                return true
            }

        // Sharing
        case "shareFile":
            let name = s(1).replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
            guard let data = Data(base64Encoded: s(0), options: .ignoreUnknownCharacters), !name.isEmpty else { reply(false); return }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let f = dir.appendingPathComponent(name)
            do { try data.write(to: f, options: .atomic) } catch { reply(false); return }
            var items: [Any] = [f]
            if !s(3).isEmpty { items.append(s(3)) }
            presentShare(items)
            reply(true)

        // Apple Health
        case "healthRequest": requestHealth(); reply(nil)
        case "healthWrite": healthWrite(s(0)); reply(nil)

        default: replyHandler(nil, "unknown call " + m)
        }
    }

    // MARK: Events to the page

    func callJs(_ fn: String, _ payload: [String: Any]) {
        guard let web = web else { return }
        let arg = json([json(payload)])
        web.evaluateJavaScript("window.bcNative && bcNative.\(fn) && bcNative.\(fn)(\(arg)[0])", completionHandler: nil)
    }

    private func orNull(_ s: String?) -> Any {
        if let s = s { return s }
        return NSNull()
    }

    func json(_ v: Any) -> String {
        guard JSONSerialization.isValidJSONObject(v), let d = try? JSONSerialization.data(withJSONObject: v) else {
            if let s = v as? String, let d = try? JSONSerialization.data(withJSONObject: [s]) {
                return String(String(decoding: d, as: UTF8.self).dropFirst().dropLast())
            }
            return "null"
        }
        return String(decoding: d, as: UTF8.self)
    }

    // MARK: Permissions

    private func authorizationChanged() {
        refreshInfo()
        callJs("onPermission", ["location": location.authorized, "steps": location.hasStepCounter])
        if pendingRecording && location.manager.authorizationStatus != .notDetermined {
            pendingRecording = false
            if location.authorized { recorder.start() }
            callJs("onRecording", ["started": location.authorized])
        }
    }

    private func startRecording() {
        if location.authorized {
            recorder.start()
            callJs("onRecording", ["started": true])
        } else if location.manager.authorizationStatus == .notDetermined {
            pendingRecording = true
            location.request()
        } else {
            callJs("onRecording", ["started": false])
        }
    }

    private func requestHealth() {
        guard health.available else { callJs("onHealthPermission", ["granted": false, "unavailable": true]); return }
        health.request { [weak self] granted in
            self?.refreshInfo()
            self?.callJs("onHealthPermission", ["granted": granted])
        }
    }

    private func healthWrite(_ id: String) {
        io.async {
            guard let meta = self.tracks.readMeta(id) else {
                DispatchQueue.main.async { self.callJs("onHealthResult", ["id": id, "ok": false, "error": "missing"]) }
                return
            }
            let fixes = self.tracks.readFixes(id)
            self.health.write(meta: meta, fixes: fixes) { ok, error in
                if ok { var m = meta; m["healthSynced"] = true; self.io.async { self.tracks.writeMeta(m) } }
                self.callJs("onHealthResult", ["id": id, "ok": ok, "error": self.orNull(error)])
            }
        }
    }

    // MARK: Files (iCloud Drive, Google Drive or any folder, through the Files picker)

    private func startBackup(includeMaps: Bool, filename: String) {
        let name = filename.isEmpty ? "bristlecone-backup.zip" : filename.replacingOccurrences(of: "/", with: "_")
        let f = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        io.async {
            do {
                let n = try self.storage.backup(to: f, includeMaps: includeMaps)
                DispatchQueue.main.async { self.presentExporter(f, job: .backup(n)) }
            } catch {
                DispatchQueue.main.async { self.fileResult("backup", ok: false, count: 0, error: error.localizedDescription) }
            }
        }
    }

    private func startRestore() {
        let p = UIDocumentPickerViewController(forOpeningContentTypes: [.zip, .data], asCopy: true)
        p.delegate = self
        pickerJob = .restore
        present(p, animated: true)
    }

    private func startExport(filename: String, base64: String) {
        let name = filename.replacingOccurrences(of: "/", with: "_")
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters), !name.isEmpty else {
            fileResult("export", ok: false, count: 0, error: "empty"); return
        }
        let f = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: f, options: .atomic) } catch { fileResult("export", ok: false, count: 0, error: error.localizedDescription); return }
        presentExporter(f, job: .export)
    }

    private func presentExporter(_ f: URL, job: PickerJob) {
        let p = UIDocumentPickerViewController(forExporting: [f], asCopy: true)
        p.delegate = self
        pickerJob = job
        present(p, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let job = pickerJob
        pickerJob = nil
        switch job {
        case .backup(let n): fileResult("backup", ok: true, count: n, error: nil)
        case .export: fileResult("export", ok: true, count: 1, error: nil)
        case .restore:
            guard let u = urls.first else { fileResult("restore", ok: false, count: 0, error: "cancelled"); return }
            io.async {
                do {
                    let n = try self.storage.restore(from: u)
                    self.regions.refreshPins()
                    DispatchQueue.main.async {
                        self.refreshStartupScript()
                        self.fileResult("restore", ok: true, count: n, error: nil)
                    }
                } catch {
                    DispatchQueue.main.async { self.fileResult("restore", ok: false, count: 0, error: error.localizedDescription) }
                }
            }
        case .none: break
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let kind: String
        switch pickerJob { case .backup: kind = "backup"; case .restore: kind = "restore"; default: kind = "export" }
        pickerJob = nil
        fileResult(kind, ok: false, count: 0, error: "cancelled")
    }

    private func fileResult(_ kind: String, ok: Bool, count: Int, error: String?) {
        callJs("onFileResult", ["kind": kind, "ok": ok, "count": count, "error": orNull(error)])
    }

    // MARK: Sharing and links

    private func presentShare(_ items: [Any]) {
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let pop = vc.popoverPresentationController {
            // iPad shows the share sheet as a popover, which needs an anchor.
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 90, width: 1, height: 1)
            pop.permittedArrowDirections = [.down]
        }
        present(vc, animated: true)
    }

    private func sms(_ text: String) {
        guard MFMessageComposeViewController.canSendText() else { presentShare([text]); return }
        let vc = MFMessageComposeViewController()
        vc.body = text
        vc.messageComposeDelegate = self
        present(vc, animated: true)
    }

    func messageComposeViewController(_ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult) {
        controller.dismiss(animated: true)
    }

    /// Only web links, map locations and email leave the app. geo: links (used on Android for
    /// directions) open in Apple Maps.
    static func externalURL(_ raw: String) -> URL? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        let scheme = s.split(separator: ":", maxSplits: 1).first.map { $0.lowercased() } ?? ""
        if scheme == "https" || scheme == "http" || scheme == "mailto" { return URL(string: s) }
        guard scheme == "geo" else { return nil }
        // geo:LAT,LON?q=LAT,LON(Label)
        let body = String(s.dropFirst(4))
        let parts = body.split(separator: "?", maxSplits: 1).map(String.init)
        let ll = parts.first ?? ""
        var label: String?
        if parts.count > 1, let open = parts[1].firstIndex(of: "("), let close = parts[1].lastIndex(of: ")"), open < close {
            label = String(parts[1][parts[1].index(after: open)..<close]).removingPercentEncoding
        }
        var c = URLComponents(string: "https://maps.apple.com/")!
        c.queryItems = [URLQueryItem(name: "ll", value: ll), URLQueryItem(name: "q", value: label ?? ll)]
        return c.url
    }

    private func openExternal(_ raw: String) {
        guard let u = WebViewController.externalURL(raw) else { return }
        UIApplication.shared.open(u)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = action.request.url else { decisionHandler(.cancel); return }
        if u.scheme == SchemeHandler.scheme {
            if action.targetFrame?.isMainFrame == true { refreshStartupScript() }
            decisionHandler(.allow)
            return
        }
        if u.scheme == "about" || u.scheme == "blob" || u.scheme == "data" { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if action.navigationType == .linkActivated { openExternal(u.absoluteString) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS can end the page's process under memory pressure; start it again.
        refreshStartupScript()
        webView.reload()
    }
}
