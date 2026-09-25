// mach-intro — plays the MACH boot animation in a transparent, click-through overlay.
//   mach-intro [--dir <intro folder>]
//   mach-intro --snap <out dir> --times 0.5,1.0 [--variant ...]   (render stills, no sound)
import Cocoa
import WebKit
import AVFoundation

struct Options {
    var variant = "strike"
    var dir: URL
    var snapDir: URL?
    var times: [Double] = []

    init() {
        let args = CommandLine.arguments
        func value(_ flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        let exe = URL(fileURLWithPath: args[0]).resolvingSymlinksInPath().deletingLastPathComponent()
        dir = value("--dir").map { URL(fileURLWithPath: $0) }
            ?? exe.deletingLastPathComponent().appendingPathComponent("intro")
        variant = value("--variant") ?? "strike"
        snapDir = value("--snap").map { URL(fileURLWithPath: $0) }
        times = (value("--times") ?? "").split(separator: ",").compactMap { Double($0) }
    }
}

final class Intro: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let opt = Options()
    var window: NSWindow!
    var web: WKWebView!
    var player: AVAudioPlayer?

    func applicationDidFinishLaunching(_ note: Notification) {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        var frame = screen.frame
        if opt.snapDir != nil { frame.origin = NSPoint(x: -30000, y: -30000) }

        window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "mach")
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .clear
        web.navigationDelegate = self
        window.contentView = web
        window.setFrame(frame, display: true)

        let wav = opt.dir.appendingPathComponent("\(opt.variant).wav")
        if opt.snapDir == nil, let p = try? AVAudioPlayer(contentsOf: wav) {
            player = p
            p.prepareToPlay()
        }

        if opt.snapDir != nil {
            window.orderFrontRegardless()
            var comps = URLComponents(url: opt.dir.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "v", value: opt.variant), URLQueryItem(name: "seek", value: "0")]
            web.loadFileURL(comps.url!, allowingReadAccessTo: opt.dir)
        } else {
            web.loadFileURL(opt.dir.appendingPathComponent("index.html"), allowingReadAccessTo: opt.dir)
        }
        // Never linger, even if the page fails to load.
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { NSApp.terminate(nil) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let out = opt.snapDir {
            snap(out, Array(opt.times))
            return
        }
        window.orderFrontRegardless()
        webView.evaluateJavaScript("MACH.start('\(opt.variant)')")
        player?.play()
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.body as? String == "done" else { return }
        let tail = player.map { max(0, $0.duration - $0.currentTime) } ?? 0
        DispatchQueue.main.asyncAfter(deadline: .now() + min(tail, 1.5)) { NSApp.terminate(nil) }
    }

    func snap(_ out: URL, _ times: [Double]) {
        guard let t = times.first else { NSApp.terminate(nil); return }
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let js = "document.body.classList.add('preview'); window.__seek && window.__seek(\(t));"
        web.evaluateJavaScript(js) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                self.web.takeSnapshot(with: nil) { image, _ in
                    if let image, let tiff = image.tiffRepresentation,
                       let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                        try? png.write(to: out.appendingPathComponent("\(self.opt.variant)_\(t).png"))
                    }
                    self.snap(out, Array(times.dropFirst()))
                }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let intro = Intro()
app.delegate = intro
app.run()
