import AppKit
import Foundation

let daemonPort: UInt16 = 41422
let daemonPidFile = "/tmp/uebersicht_menu_daemon_cava.pid"
let menuPidFile = "/tmp/uebersicht_active_menu.pid"
let menuDismissFile = "/tmp/uebersicht_menu_dismissed.ts"

var activeMenu: NSMenu? = nil
var isMenuOpen = false
var lastDismissTs: Double = 0

struct MenuState: Codable {
    var mode: String?
    var instanceId: String?
    var enableSnapping: Bool?
    var screenId: String?
    var x: Int?
    var y: Int?
}

class MenuDelegate: NSObject {
    var outputAction: String?

    @objc func handleItem(_ sender: NSMenuItem) {
        outputAction = sender.representedObject as? String
    }
}

let helperPath = CommandLine.arguments[0]
let widgetFolder = URL(fileURLWithPath: helperPath).deletingLastPathComponent().lastPathComponent
let widgetId = widgetFolder.replacingOccurrences(of: ".", with: "-") + "-index-jsx"

func ensureDaemonRunning() {
    if let pidStr = try? String(contentsOfFile: daemonPidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       let pid = Int32(pidStr), pid > 0 {
        if kill(pid, 0) == 0 {
            return
        }
    }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: helperPath)
    task.arguments = ["--daemon"]
    task.standardInput = FileHandle.nullDevice
    task.standardOutput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    try? task.run()
}

func getScreensJson() -> String {
    let screens = NSScreen.screens
    var screenInfos: [[String: Any]] = []
    for (i, s) in screens.enumerated() {
        let desc = s.deviceDescription
        let screenNumber = desc[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID ?? 0
        screenInfos.append([
            "index": i,
            "id": screenNumber,
            "name": s.localizedName,
            "isMain": s == NSScreen.main,
            "x": Int(s.frame.origin.x),
            "y": Int(s.frame.origin.y),
            "w": Int(s.frame.size.width),
            "h": Int(s.frame.size.height)
        ])
    }
    if let data = try? JSONSerialization.data(withJSONObject: screenInfos),
       let json = String(data: data, encoding: .utf8) {
        return json
    }
    return "[]"
}

func reloadWidget(widgetId: String) {
    let script = "tell application id \"tracesOf.Uebersicht\" to reload widget id \"\(widgetId)\""
    var err: NSDictionary?
    NSAppleScript(source: script)?.executeAndReturnError(&err)
    if err != nil {
        let refreshScript = "tell application id \"tracesOf.Uebersicht\" to refresh"
        NSAppleScript(source: refreshScript)?.executeAndReturnError(nil)
    }
}

func buildMenu(state: MenuState, delegate: MenuDelegate) -> NSMenu {
    let instanceId = state.instanceId ?? "default"
    let hasSnapping = state.enableSnapping ?? true

    let menu = NSMenu(title: "CAVA Controls")
    menu.autoenablesItems = false

    let orderParent = NSMenuItem(title: "Order", action: nil, keyEquivalent: "")
    let orderMenu = NSMenu(title: "Order")
    orderMenu.autoenablesItems = false
    let orderOptions: [(String, String)] = [
        ("Bring to Front", "ORDER_FRONT"),
        ("Bring Forward", "ORDER_FORWARD"),
        ("Send Backward", "ORDER_BACKWARD"),
        ("Send to Back", "ORDER_BACK")
    ]
    for (label, act) in orderOptions {
        let item = NSMenuItem(title: label, action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
        item.target = delegate
        item.representedObject = "{\"action\":\"\(act)\"}"
        orderMenu.addItem(item)
    }
    orderParent.submenu = orderMenu
    menu.addItem(orderParent)

    let snapItem = NSMenuItem(title: "Snap to Edges", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
    snapItem.target = delegate
    snapItem.representedObject = "{\"action\":\"TOGGLE_SNAPPING\"}"
    if hasSnapping {
        snapItem.state = .on
    }
    menu.addItem(snapItem)

    menu.addItem(NSMenuItem.separator())

    let resetItem = NSMenuItem(title: "Reset Position", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
    resetItem.target = delegate
    resetItem.representedObject = "{\"action\":\"RESET_POSITION\",\"instanceId\":\"\(instanceId)\"}"
    menu.addItem(resetItem)

    let screens = NSScreen.screens
    if screens.count > 1 {
        let dispParent = NSMenuItem(title: "Display", action: nil, keyEquivalent: "")
        let dispMenu = NSMenu(title: "Display")
        dispMenu.autoenablesItems = false
        let currentScreen = state.screenId ?? ""
        let allScreenIds: [String] = screens.map { s in
            let desc = s.deviceDescription
            let screenNumber = desc[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID ?? 0
            return "screen_\(screenNumber)"
        }
        let hasExactMatch = allScreenIds.contains(currentScreen)
        for (i, s) in screens.enumerated() {
            let sid = allScreenIds[i]
            let label = s.localizedName.isEmpty ? "Display \(i + 1)" : s.localizedName
            let item = NSMenuItem(title: label, action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
            item.target = delegate
            item.representedObject = "{\"action\":\"MOVE_TO_SCREEN\",\"screenId\":\"\(sid)\",\"instanceId\":\"\(instanceId)\"}"
            let isCurrent = hasExactMatch ? (currentScreen == sid) : (s == NSScreen.main)
            if isCurrent {
                item.state = .on
            }
            dispMenu.addItem(item)
        }
        dispParent.submenu = dispMenu
        menu.addItem(dispParent)
    }

    let reloadItem = NSMenuItem(title: "Reload Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
    reloadItem.target = delegate
    reloadItem.representedObject = "{\"action\":\"RELOAD_WIDGET\",\"widgetId\":\"\(widgetId)\"}"
    menu.addItem(reloadItem)

    let dupItem = NSMenuItem(title: "Duplicate Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
    dupItem.target = delegate
    dupItem.representedObject = "{\"action\":\"DUPLICATE_WIDGET\",\"instanceId\":\"\(instanceId)\"}"
    menu.addItem(dupItem)

    let removeItem = NSMenuItem(title: "Remove Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
    removeItem.target = delegate
    removeItem.representedObject = "{\"action\":\"REMOVE_WIDGET\",\"instanceId\":\"\(instanceId)\",\"widgetId\":\"\(widgetId)\"}"
    menu.addItem(removeItem)

    return menu
}

func executeMenuOnMain(state: MenuState) -> String {
    let nowTs = Date().timeIntervalSince1970

    if let pidStr = try? String(contentsOfFile: menuPidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       let oldPid = Int32(pidStr), oldPid > 0, oldPid != getpid() {
        if kill(oldPid, 0) == 0 {
            kill(oldPid, SIGUSR1)
            try? FileManager.default.removeItem(atPath: menuPidFile)
            try? String(format: "%.4f", nowTs).write(toFile: menuDismissFile, atomically: true, encoding: .utf8)
            lastDismissTs = nowTs
            return ""
        }
    }

    if (nowTs - lastDismissTs) >= 0 && (nowTs - lastDismissTs) < 0.25 {
        lastDismissTs = 0
        try? FileManager.default.removeItem(atPath: menuDismissFile)
        return ""
    }

    if let tsStr = try? String(contentsOfFile: menuDismissFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       let fileDismiss = Double(tsStr) {
        try? FileManager.default.removeItem(atPath: menuDismissFile)
        if (nowTs - fileDismiss) >= 0 && (nowTs - fileDismiss) < 0.25 {
            lastDismissTs = 0
            return ""
        }
    }

    let delegate = MenuDelegate()
    let menu = buildMenu(state: state, delegate: delegate)

    activeMenu = menu
    isMenuOpen = true
    try? "\(getpid())".write(toFile: menuPidFile, atomically: true, encoding: .utf8)

    NSApp.activate(ignoringOtherApps: true)
    let mouseLoc = NSEvent.mouseLocation
    let selected = menu.popUp(positioning: nil, at: mouseLoc, in: nil)

    isMenuOpen = false
    activeMenu = nil
    try? FileManager.default.removeItem(atPath: menuPidFile)

    if !selected && delegate.outputAction == nil {
        let endTs = Date().timeIntervalSince1970
        lastDismissTs = endTs
        try? String(format: "%.4f", endTs).write(toFile: menuDismissFile, atomically: true, encoding: .utf8)
    } else {
        lastDismissTs = 0
        try? FileManager.default.removeItem(atPath: menuDismissFile)
    }

    if let action = delegate.outputAction {
        if let data = action.data(using: .utf8),
           let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let act = json["action"] as? String {
            if act == "RELOAD_WIDGET" {
                DispatchQueue.global().async {
                    reloadWidget(widgetId: widgetId)
                }
            }
        }
        return action
    }
    return ""
}

func sendHttpResponse(_ clientFd: Int32, status: String = "200 OK", body: String = "") {
    let bodyData = body.data(using: .utf8) ?? Data()
    let header = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: \(bodyData.count)\r\nConnection: close\r\n\r\n"
    var fullData = header.data(using: .utf8) ?? Data()
    fullData.append(bodyData)
    fullData.withUnsafeBytes { rawBuf in
        if let base = rawBuf.baseAddress {
            _ = write(clientFd, base, fullData.count)
        }
    }
    close(clientFd)
}

func handleHttpClient(_ clientFd: Int32) {
    var flag: Int32 = 1
    setsockopt(clientFd, IPPROTO_TCP, TCP_NODELAY, &flag, socklen_t(MemoryLayout<Int32>.size))

    var requestData = Data()
    var buf = [UInt8](repeating: 0, count: 8192)
    var expectedTotalBytes: Int? = nil

    while true {
        let n = read(clientFd, &buf, buf.count)
        if n <= 0 { break }
        requestData.append(contentsOf: buf[0..<n])

        if expectedTotalBytes == nil,
           let str = String(data: requestData, encoding: .utf8),
           let headerEndRange = str.range(of: "\r\n\r\n") {
            let headerPart = String(str[..<headerEndRange.lowerBound])
            let headerByteLen = headerPart.utf8.count + 4
            var contentLen = 0
            for line in headerPart.components(separatedBy: "\r\n") {
                if line.lowercased().hasPrefix("content-length:") {
                    let valStr = line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)
                    contentLen = Int(valStr) ?? 0
                }
            }
            expectedTotalBytes = headerByteLen + contentLen
        }

        if let expected = expectedTotalBytes, requestData.count >= expected {
            break
        }
    }

    guard let rawReq = String(data: requestData, encoding: .utf8), !rawReq.isEmpty else {
        close(clientFd)
        return
    }

    let firstLine = rawReq.components(separatedBy: "\r\n").first ?? ""
    if firstLine.hasPrefix("OPTIONS ") {
        sendHttpResponse(clientFd, status: "204 No Content", body: "")
        return
    }

    if firstLine.hasPrefix("GET /screens") {
        var jsonOut = "[]"
        let sem = DispatchSemaphore(value: 0)
        CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) {
            jsonOut = getScreensJson()
            sem.signal()
        }
        CFRunLoopWakeUp(CFRunLoopGetMain())
        sem.wait()
        sendHttpResponse(clientFd, body: jsonOut)
        return
    }

    var bodyStr = ""
    if let range = rawReq.range(of: "\r\n\r\n") {
        bodyStr = String(rawReq[range.upperBound...])
    }

    if isMenuOpen {
        let nowTs = Date().timeIntervalSince1970
        lastDismissTs = nowTs
        try? String(format: "%.4f", nowTs).write(toFile: menuDismissFile, atomically: true, encoding: .utf8)
        CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) {
            activeMenu?.cancelTracking()
        }
        CFRunLoopWakeUp(CFRunLoopGetMain())
        sendHttpResponse(clientFd, body: "")
        return
    }

    var reqState = MenuState()
    if let data = bodyStr.data(using: .utf8) {
        reqState = (try? JSONDecoder().decode(MenuState.self, from: data)) ?? MenuState()
    }

    var actionResult = ""
    let sem = DispatchSemaphore(value: 0)
    CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) {
        actionResult = executeMenuOnMain(state: reqState)
        sem.signal()
    }
    CFRunLoopWakeUp(CFRunLoopGetMain())
    sem.wait()

    sendHttpResponse(clientFd, body: actionResult)
}

func runDaemon() -> Never {
    let serverFd = socket(AF_INET, SOCK_STREAM, 0)
    if serverFd < 0 { exit(1) }

    var reuse: Int32 = 1
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = daemonPort.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")

    let bindRes = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(serverFd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    if bindRes < 0 {
        close(serverFd)
        exit(0)
    }

    if listen(serverFd, 16) < 0 {
        close(serverFd)
        exit(1)
    }

    try? "\(getpid())".write(toFile: daemonPidFile, atomically: true, encoding: .utf8)

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)

    signal(SIGUSR1, SIG_IGN)
    let sigSrc = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    sigSrc.setEventHandler {
        if isMenuOpen, let m = activeMenu {
            let nowTs = Date().timeIntervalSince1970
            lastDismissTs = nowTs
            try? String(format: "%.4f", nowTs).write(toFile: menuDismissFile, atomically: true, encoding: .utf8)
            m.cancelTracking()
        }
    }
    sigSrc.resume()

    DispatchQueue.global(qos: .userInteractive).async {
        while true {
            let clientFd = accept(serverFd, nil, nil)
            if clientFd < 0 { continue }
            DispatchQueue.global(qos: .userInteractive).async {
                handleHttpClient(clientFd)
            }
        }
    }

    RunLoop.main.run()
    exit(0)
}

if CommandLine.arguments.contains("--daemon") {
    runDaemon()
}

ensureDaemonRunning()

var cliState = MenuState()
if CommandLine.arguments.count > 1 {
    let jsonStr = CommandLine.arguments[1]
    if let data = jsonStr.data(using: .utf8) {
        cliState = (try? JSONDecoder().decode(MenuState.self, from: data)) ?? MenuState()
    }
}

if CommandLine.arguments.contains("--screens") || cliState.mode == "GET_SCREENS" {
    print(getScreensJson())
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let out = executeMenuOnMain(state: cliState)
if !out.isEmpty {
    print(out)
}
