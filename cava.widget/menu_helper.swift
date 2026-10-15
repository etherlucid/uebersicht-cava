import AppKit
import Foundation

struct MenuState: Codable {
    var enableSnapping: Bool?
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

let hasSnapping = state.enableSnapping ?? true

let helperPath = CommandLine.arguments[0]
let widgetDir = URL(fileURLWithPath: helperPath).deletingLastPathComponent().path
let widgetFolder = URL(fileURLWithPath: helperPath).deletingLastPathComponent().lastPathComponent
let widgetId = widgetFolder.replacingOccurrences(of: ".", with: "-") + "-index-jsx"

func duplicateWidget(widgetDir: String, currentX: Int, currentY: Int) -> String? {
    let fileManager = FileManager.default
    let parentDir = (widgetDir as NSString).deletingLastPathComponent
    let folderName = (widgetDir as NSString).lastPathComponent

    let rawName = folderName.replacingOccurrences(of: ".widget", with: "")
    let regex = try? NSRegularExpression(pattern: "^(.*?)(?:-\\d+)?$")
    var baseName = rawName
    if let match = regex?.firstMatch(in: rawName, range: NSRange(rawName.startIndex..., in: rawName)),
       let r = Range(match.range(at: 1), in: rawName) {
        baseName = String(rawName[r])
    }

    var n = 2
    var targetDir = ""
    var targetName = ""
    while true {
        targetName = "\(baseName)-\(n).widget"
        targetDir = (parentDir as NSString).appendingPathComponent(targetName)
        if !fileManager.fileExists(atPath: targetDir) {
            break
        }
        n += 1
    }

    do {
        try fileManager.copyItem(atPath: widgetDir, toPath: targetDir)

        let indexPath = (targetDir as NSString).appendingPathComponent("index.jsx")
        if let data = fileManager.contents(atPath: indexPath),
           var content = String(data: data, encoding: .utf8) {

            if let keyRegex = try? NSRegularExpression(pattern: "(STORAGE_\\w+_KEY|POS_KEY|SIZE_KEY|STORAGE_KEY)(\\s*=\\s*['\"])([^'\"]+)(['\"])") {
                content = keyRegex.stringByReplacingMatches(in: content, range: NSRange(content.startIndex..., in: content), withTemplate: "$1$2$3_\(n)$4")
            }

            if let defXRegex = try? NSRegularExpression(pattern: "(defaultX\\s*=\\s*)(\\d+)") {
                content = defXRegex.stringByReplacingMatches(in: content, range: NSRange(content.startIndex..., in: content), withTemplate: "$1\(currentX + 30)")
            }

            if let defYRegex = try? NSRegularExpression(pattern: "(defaultY\\s*=\\s*)(\\d+)") {
                content = defYRegex.stringByReplacingMatches(in: content, range: NSRange(content.startIndex..., in: content), withTemplate: "$1\(currentY + 30)")
            }

            try content.write(toFile: indexPath, atomically: true, encoding: .utf8)
        }

        let script = "tell application id \"tracesOf.Uebersicht\" to refresh"
        NSAppleScript(source: script)?.executeAndReturnError(nil)
        return targetName
    } catch {
        return nil
    }
}

func removeWidget(widgetDir: String, widgetId: String, widgetFolder: String) {
    let isDuplicate = widgetFolder.range(of: "-(\\d+)\\.widget$", options: .regularExpression) != nil ||
                      widgetFolder.contains("copy")
    if isDuplicate {
        let script = "tell application \"Finder\" to delete POSIX file \"\(widgetDir)\""
        NSAppleScript(source: script)?.executeAndReturnError(nil)
    } else {
        let script = "tell application id \"tracesOf.Uebersicht\" to set hidden of widget id \"\(widgetId)\" to true"
        NSAppleScript(source: script)?.executeAndReturnError(nil)
    }
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
resetItem.representedObject = "{\"action\":\"RESET_POSITION\"}"
menu.addItem(resetItem)

// Reload Widget
let reloadItem = NSMenuItem(title: "Reload Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
reloadItem.target = delegate
reloadItem.representedObject = "{\"action\":\"RELOAD_WIDGET\",\"widgetId\":\"\(widgetId)\",\"widgetDir\":\"\(widgetDir)\",\"widgetFolder\":\"\(widgetFolder)\"}"
menu.addItem(reloadItem)

// Duplicate Widget
let dupItem = NSMenuItem(title: "Duplicate Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
dupItem.target = delegate
dupItem.representedObject = "{\"action\":\"DUPLICATE_WIDGET\",\"widgetId\":\"\(widgetId)\",\"widgetDir\":\"\(widgetDir)\",\"widgetFolder\":\"\(widgetFolder)\"}"
menu.addItem(dupItem)

// Remove Widget
let removeItem = NSMenuItem(title: "Remove Widget", action: #selector(MenuDelegate.handleItem(_:)), keyEquivalent: "")
removeItem.target = delegate
removeItem.representedObject = "{\"action\":\"REMOVE_WIDGET\",\"widgetId\":\"\(widgetId)\",\"widgetDir\":\"\(widgetDir)\",\"widgetFolder\":\"\(widgetFolder)\"}"
menu.addItem(removeItem)

// Pop up native menu above all windows at cursor location
let mouseLoc = NSEvent.mouseLocation
menu.popUp(positioning: nil, at: mouseLoc, in: nil)

if let action = delegate.outputAction {
    print(action)
    if let data = action.data(using: .utf8),
       let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
       let act = json["action"] as? String {
        if act == "RELOAD_WIDGET" {
            reloadWidget(widgetId: widgetId)
        } else if act == "DUPLICATE_WIDGET" {
            _ = duplicateWidget(widgetDir: widgetDir, currentX: state.x ?? 100, currentY: state.y ?? 100)
        } else if act == "REMOVE_WIDGET" {
            removeWidget(widgetDir: widgetDir, widgetId: widgetId, widgetFolder: widgetFolder)
        }
    }
}
