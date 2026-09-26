// mach-player — plays one MACH boot screen in a transparent, click-through overlay.
//   mach-player --screen <screen folder>
//   mach-player --screen <screen folder> --snap <out dir> --fps 15   (render frames, no sound)
//
// A screen folder holds index.html (required), screen.json and sound.wav
// (both optional). See README.md for the contract a screen implements.
import Cocoa
import WebKit
import AVFoundation

struct Options {
    var dir: URL
    var snapDir: URL?
    var fps = 15.0

    init() {
        let args = CommandLine.arguments
        func value(_ flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        let root = URL(fileURLWithPath: args[0]).resolvingSymlinksInPath()
            .deletingLastPathComponent().deletingLastPathComponent()
        dir = value("--screen").map { URL(fileURLWithPath: $0) }
            ?? root.appendingPathComponent("screens/strike")
        snapDir = value("--snap").map { URL(fileURLWithPath: $0) }
        fps = value("--fps").flatMap(Double.init) ?? 15
    }
}

/// The optional screen.json next to index.html.
struct Manifest: Decodable {
    var name: String?
    var duration: Double?

    static func load(_ dir: URL) -> Manifest {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("screen.json")),
              let m = try? JSONDecoder().decode(Manifest.self, from: data) else { return Manifest() }
        return m
    }
}

final class Player: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let opt = Options()
    lazy var manifest = Manifest.load(opt.dir)
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

        let page = opt.dir.appendingPathComponent("index.html")
        if opt.snapDir != nil {
            window.orderFrontRegardless()
            var comps = URLComponents(url: page, resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "seek", value: "0")]
            web.loadFileURL(comps.url!, allowingReadAccessTo: opt.dir)
            return
        }

        if let p = try? AVAudioPlayer(contentsOf: opt.dir.appendingPathComponent("sound.wav")) {
            player = p
            p.prepareToPlay()
        }
        web.loadFileURL(page, allowingReadAccessTo: opt.dir)
        // Never linger, even if the page fails to load or never reports done.
        let limit = (manifest.duration ?? 9) + 3
        DispatchQueue.main.asyncAfter(deadline: .now() + limit) { NSApp.terminate(nil) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let out = opt.snapDir {
            try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
            let duration = manifest.duration ?? 6
            let count = Int((duration * opt.fps).rounded(.up))
            // .recording lets a screen hide preview-only UI (hints, cursors).
            webView.evaluateJavaScript("document.body.classList.add('preview', 'recording')") { _, _ in
                self.snap(out, frame: 0, count: count)
            }
            return
        }
        window.orderFrontRegardless()
        webView.evaluateJavaScript("MACH.start()")
        player?.play()
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard opt.snapDir == nil, message.body as? String == "done" else { return }
        let tail = player.map { max(0, $0.duration - $0.currentTime) } ?? 0
        DispatchQueue.main.asyncAfter(deadline: .now() + min(tail, 1.5)) { NSApp.terminate(nil) }
    }

    /// Frames are numbered so ffmpeg can read them as a sequence.
    func snap(_ out: URL, frame: Int, count: Int) {
        guard frame < count else { NSApp.terminate(nil); return }
        let t = Double(frame) / opt.fps
        web.evaluateJavaScript("window.__seek && window.__seek(\(t))") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.web.takeSnapshot(with: nil) { image, _ in
                    if let image, let tiff = image.tiffRepresentation,
                       let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                        try? png.write(to: out.appendingPathComponent(String(format: "frame_%04d.png", frame)))
                    }
                    self.snap(out, frame: frame + 1, count: count)
                }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let player = Player()
app.delegate = player
app.run()
