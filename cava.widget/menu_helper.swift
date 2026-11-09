import AppKit
import Foundation

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

var state = MenuState()
if CommandLine.arguments.count > 1 {
    let jsonStr = CommandLine.arguments[1]
    if let data = jsonStr.data(using: .utf8) {
        state = (try? JSONDecoder().decode(MenuState.self, from: data)) ?? MenuState()
    }
}

if CommandLine.arguments.contains("--screens") || state.mode == "GET_SCREENS" {
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
        print(json)
    }
    exit(0)
}

let instanceId = state.instanceId ?? "default"
let hasSnapping = state.enableSnapping ?? true

let helperPath = CommandLine.arguments[0]
let widgetFolder = URL(fileURLWithPath: helperPath).deletingLastPathComponent().lastPathComponent
let widgetId = widgetFolder.replacingOccurrences(of: ".", with: "-") + "-index-jsx"

func reloadWidget(widgetId: String) {
    let script = "tell application id \"tracesOf.Uebersicht\" to reload widget id \"\(widgetId)\""
    var err: NSDictionary?
    NSAppleScript(source: script)?.executeAndReturnError(&err)
    if err != nil {
        let refreshScript = "tell application id \"tracesOf.Uebersicht\" to refresh"
        NSAppleScript(source: refreshScript)?.executeAndReturnError(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = MenuDelegate()
let menu = NSMenu(title: "CAVA Controls")
menu.autoenablesItems = false

// Order Submenu
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

// Snapping Toggle
let snapItem = NSMenuItem(title: "Snap to Edges", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
snapItem.target = delegate
snapItem.representedObject = "{\"action\":\"TOGGLE_SNAPPING\"}"
if hasSnapping {
    snapItem.state = .on
}
menu.addItem(snapItem)

menu.addItem(NSMenuItem.separator())

// Reset Position
let resetItem = NSMenuItem(title: "Reset Position", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
resetItem.target = delegate
resetItem.representedObject = "{\"action\":\"RESET_POSITION\",\"instanceId\":\"\(instanceId)\"}"
menu.addItem(resetItem)

// Display Submenu
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

// Reload Widget
let reloadItem = NSMenuItem(title: "Reload Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
reloadItem.target = delegate
reloadItem.representedObject = "{\"action\":\"RELOAD_WIDGET\",\"widgetId\":\"\(widgetId)\"}"
menu.addItem(reloadItem)

// Duplicate Widget
let dupItem = NSMenuItem(title: "Duplicate Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
dupItem.target = delegate
dupItem.representedObject = "{\"action\":\"DUPLICATE_WIDGET\",\"instanceId\":\"\(instanceId)\"}"
menu.addItem(dupItem)

// Remove Widget
let removeItem = NSMenuItem(title: "Remove Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
removeItem.target = delegate
removeItem.representedObject = "{\"action\":\"REMOVE_WIDGET\",\"instanceId\":\"\(instanceId)\",\"widgetId\":\"\(widgetId)\"}"
menu.addItem(removeItem)

// Pop up native menu above all windows at cursor location
let menuPidFile = "/tmp/uebersicht_active_menu.pid"
let menuDismissFile = "/tmp/uebersicht_menu_dismissed.ts"
let nowTs = Date().timeIntervalSince1970

if let pidStr = try? String(contentsOfFile: menuPidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
   let oldPid = Int32(pidStr), oldPid > 0, oldPid != getpid() {
    if kill(oldPid, 0) == 0 {
        kill(oldPid, SIGTERM)
        try? FileManager.default.removeItem(atPath: menuPidFile)
        try? String(format: "%.4f", nowTs).write(toFile: menuDismissFile, atomically: true, encoding: .utf8)
        exit(0)
    }
}

if let tsStr = try? String(contentsOfFile: menuDismissFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
   let lastDismiss = Double(tsStr) {
    try? FileManager.default.removeItem(atPath: menuDismissFile)
    if (nowTs - lastDismiss) >= 0 && (nowTs - lastDismiss) < 0.25 {
        exit(0)
    }
}

try? "\(getpid())".write(toFile: menuPidFile, atomically: true, encoding: .utf8)
NSApp.activate(ignoringOtherApps: true)
let mouseLoc = NSEvent.mouseLocation
let selected = menu.popUp(positioning: nil, at: mouseLoc, in: nil)
try? FileManager.default.removeItem(atPath: menuPidFile)
if !selected && delegate.outputAction == nil {
    let endTs = Date().timeIntervalSince1970
    try? String(format: "%.4f", endTs).write(toFile: menuDismissFile, atomically: true, encoding: .utf8)
} else {
    try? FileManager.default.removeItem(atPath: menuDismissFile)
}

if let action = delegate.outputAction {
    print(action)
    if let data = action.data(using: .utf8),
       let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
       let act = json["action"] as? String {
        if act == "RELOAD_WIDGET" {
            reloadWidget(widgetId: widgetId)
        } else if act == "SNAP_TO_EXTERNAL_DISPLAY" {
            let syncTool = URL(fileURLWithPath: helperPath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("display_sync").path
            let task = Process()
            task.executableURL = URL(fileURLWithPath: syncTool)
            try? task.run()
        }
    }
}
