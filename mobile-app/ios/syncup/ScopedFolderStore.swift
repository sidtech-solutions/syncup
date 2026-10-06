import Foundation
import UIKit

/// Manages security-scoped bookmarks for user-picked external folders so the
/// gomobile syncthing core can read/write them through standard POSIX APIs.
/// Mirrors the role of Android's SAFProvider, but iOS scoped resources don't
/// need a custom filesystem driver — once `startAccessingSecurityScopedResource`
/// is held, the URL.path is a real path the daemon uses directly.
@objc(ScopedFolderStore) final class ScopedFolderStore: NSObject {
    @objc static let shared = ScopedFolderStore()

    private static let defaultsKey = "com.siddarthkay.syncup.scopedFolders.v1"

    private struct Entry: Codable {
        let id: String
        let bookmark: Data
        var displayName: String
        var lastResolvedPath: String
        let addedAt: Date
        var previousPaths: [String]

        init(id: String, bookmark: Data, displayName: String,
             lastResolvedPath: String, addedAt: Date, previousPaths: [String] = []) {
            self.id = id
            self.bookmark = bookmark
            self.displayName = displayName
            self.lastResolvedPath = lastResolvedPath
            self.addedAt = addedAt
            self.previousPaths = previousPaths
        }

        private enum CodingKeys: String, CodingKey {
            case id, bookmark, displayName, lastResolvedPath, addedAt, previousPaths
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            bookmark = try c.decode(Data.self, forKey: .bookmark)
            displayName = try c.decode(String.self, forKey: .displayName)
            lastResolvedPath = try c.decode(String.self, forKey: .lastResolvedPath)
            addedAt = try c.decode(Date.self, forKey: .addedAt)
            previousPaths = try c.decodeIfPresent([String].self, forKey: .previousPaths) ?? []
        }
    }

    /// id -> live URL with security scope started. Acquire/release tracks
    /// reference balance per id (start once, stop once).
    private var acquired: [String: URL] = [:]
    private let queue = DispatchQueue(label: "com.siddarthkay.syncup.scopedFolders")

    /// Strong refs to picker delegates so they survive until completion fires.
    private var pendingDelegates: [ObjectIdentifier: NSObject] = [:]

    private override init() {
        super.init()
    }

    // MARK: - Persistence

    private func loadEntries() -> [Entry] {
        guard let data = UserDefaults.standard.data(forKey: Self.defaultsKey) else {
            return []
        }
        do {
            return try JSONDecoder().decode([Entry].self, from: data)
        } catch {
            NSLog("ScopedFolderStore: decode failed: %@", "\(error)")
            return []
        }
    }

    private func saveEntries(_ entries: [Entry]) {
        do {
            let data = try JSONEncoder().encode(entries)
            UserDefaults.standard.set(data, forKey: Self.defaultsKey)
        } catch {
            NSLog("ScopedFolderStore: encode failed: %@", "\(error)")
        }
    }

    // MARK: - Public API used by GoBridgeWrapper

    /// Presents UIDocumentPickerViewController in folder-open mode and blocks
    /// the calling thread until the user picks or cancels. Caller MUST be on
    /// a non-main thread (the JS TurboModule thread is fine).
    /// Returns JSON: { ok, id, path, displayName, isUbiquitous } or empty on cancel.
    @objc func pickFolderBlocking() -> String {
        if Thread.isMainThread {
            NSLog("ScopedFolderStore: pickFolderBlocking called on main thread; would deadlock")
            return ""
        }
        let semaphore = DispatchSemaphore(value: 0)
        var result: String = ""

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { semaphore.signal(); return }
            guard let presenter = self.topPresentingViewController() else {
                NSLog("ScopedFolderStore: no presenter VC")
                semaphore.signal()
                return
            }
            let picker = UIDocumentPickerViewController(
                documentTypes: ["public.folder"],
                in: .open
            )
            picker.allowsMultipleSelection = false
            let delegate = PickerDelegate { [weak self] urls in
                defer { semaphore.signal() }
                guard let self = self, let url = urls.first else { return }
                if let json = self.persistPickedURL(url) {
                    result = json
                }
            }
            picker.delegate = delegate
            // Strong ref so delegate isn't dealloc'd before picker finishes.
            let key = ObjectIdentifier(picker)
            self.queue.sync { self.pendingDelegates[key] = delegate }
            // Clear ref once picker is dismissed (delegate fires either path).
            delegate.onComplete = { [weak self] in
                self?.queue.sync { self?.pendingDelegates.removeValue(forKey: key) }
            }
            presenter.present(picker, animated: true, completion: nil)
        }

        semaphore.wait()
        return result
    }

    /// Persist the picked URL as a security-scoped bookmark and start scope so
    /// the daemon can read/write immediately. Returns JSON describing the entry.
    private func persistPickedURL(_ url: URL) -> String? {
        // Must hold scope to mint a bookmark from a UIDocumentPicker URL.
        let didStart = url.startAccessingSecurityScopedResource()
        defer {
            // Re-acquired below if we keep the entry; release the temporary
            // scope so the reference count is balanced.
            if didStart { url.stopAccessingSecurityScopedResource() }
        }

        let bookmarkData: Data
        do {
            bookmarkData = try url.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
        } catch {
            NSLog("ScopedFolderStore: bookmarkData failed: %@", "\(error)")
            return nil
        }

        let id = UUID().uuidString
        let displayName = self.deriveDisplayName(url)
        let isUbiquitous = self.isUbiquitous(url)
        let path = url.path

        var entries = loadEntries()
        entries.removeAll(where: { $0.lastResolvedPath == path })
        entries.append(Entry(
            id: id,
            bookmark: bookmarkData,
            displayName: displayName,
            lastResolvedPath: path,
            addedAt: Date()
        ))
        saveEntries(entries)

        // Re-acquire scope under the live `acquired` map so the daemon can use
        // the path immediately without waiting for the next acquireAll cycle.
        if url.startAccessingSecurityScopedResource() {
            queue.sync { self.acquired[id] = url }
        }

        let payload: [String: Any] = [
            "ok": true,
            "id": id,
            "path": path,
            "displayName": displayName,
            "isUbiquitous": isUbiquitous,
        ]
        return jsonString(payload) ?? ""
    }

    /// Returns JSON array: [{ id, path, displayName, isStale, previousPaths }].
    @objc func getPersistedFoldersJSON() -> String {
        let entries = loadEntries()
        var out: [[String: Any]] = []
        for e in entries {
            var stale = false
            _ = try? URL(
                resolvingBookmarkData: e.bookmark,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )
            out.append([
                "id": e.id,
                "path": e.lastResolvedPath,
                "displayName": e.displayName,
                "isStale": stale,
                "previousPaths": e.previousPaths,
            ])
        }
        return jsonString(out) ?? "[]"
    }

    /// True if the bookmark resolves cleanly (and isn't stale).
    @objc func validateFolderByPath(_ path: String) -> Bool {
        guard let entry = findEntry(byPath: path) else { return false }
        var stale = false
        do {
            _ = try URL(
                resolvingBookmarkData: entry.bookmark,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )
            return !stale
        } catch {
            return false
        }
    }

    @objc func getDisplayName(byPath path: String) -> String {
        return findEntry(byPath: path)?.displayName ?? ""
    }

    /// Stop scope, drop entry. Idempotent.
    @objc func revokeFolderByPath(_ path: String) -> Bool {
        guard let entry = findEntry(byPath: path) else { return false }
        queue.sync {
            if let url = self.acquired.removeValue(forKey: entry.id) {
                url.stopAccessingSecurityScopedResource()
            }
        }
        var entries = loadEntries()
        entries.removeAll(where: { $0.id == entry.id })
        saveEntries(entries)
        return true
    }

    /// Resolve every persisted bookmark and start security-scoped access.
    /// Returns a [path: path] dict (suitable for callers that want to feed
    /// each path to a registry like MobileAPI.RegisterExternalRoot).
    @objc func acquireAll() -> [String: String] {
        var entries = loadEntries()
        var result: [String: String] = [:]
        var dirty = false

        for i in 0..<entries.count {
            let e = entries[i]
            // Don't double-acquire on re-entry (e.g. BG launches that hit a
            if let existing = (queue.sync { self.acquired[e.id] }) {
                if FileManager.default.fileExists(atPath: existing.path) {
                    result[existing.path] = existing.path
                    continue
                }
                NSLog("ScopedFolderStore: acquired path vanished for %@: %@",
                      e.id, existing.path)
                existing.stopAccessingSecurityScopedResource()
                queue.sync { _ = self.acquired.removeValue(forKey: e.id) }
            }
            var stale = false
            let url: URL
            do {
                url = try URL(
                    resolvingBookmarkData: e.bookmark,
                    options: [],
                    relativeTo: nil,
                    bookmarkDataIsStale: &stale
                )
            } catch {
                NSLog("ScopedFolderStore: resolve failed for %@: %@", e.id, "\(error)")
                continue
            }
            if !url.startAccessingSecurityScopedResource() {
                NSLog("ScopedFolderStore: scope start failed for %@", e.id)
                continue
            }
            queue.sync { self.acquired[e.id] = url }
            result[url.path] = url.path

            // Refresh stored metadata if the resolved path drifted (rare on
            // iPhone, can happen when the user moves an iCloud folder).
            if url.path != e.lastResolvedPath {
                NSLog("ScopedFolderStore: path drift for %@: %@ -> %@",
                      e.id, e.lastResolvedPath, url.path)
                // Remember the old location so lookups by the path still in
                // syncthing's config keep resolving to this entry, and so JS
                // can discover where the folder went.
                if !entries[i].previousPaths.contains(e.lastResolvedPath) {
                    entries[i].previousPaths.append(e.lastResolvedPath)
                }
                entries[i].previousPaths.removeAll(where: { $0 == url.path })
                entries[i].lastResolvedPath = url.path
                dirty = true
            }
            if stale {
                if let fresh = try? url.bookmarkData(
                    options: [],
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                ) {
                    entries[i] = Entry(
                        id: e.id,
                        bookmark: fresh,
                        displayName: entries[i].displayName,
                        lastResolvedPath: url.path,
                        addedAt: e.addedAt,
                        previousPaths: entries[i].previousPaths
                    )
                    dirty = true
                }
            }
        }
        if dirty { saveEntries(entries) }
        return result
    }

    /// Stop scope on every currently-acquired URL. Pair with acquireAll.
    @objc func releaseAll() {
        queue.sync {
            for (_, url) in self.acquired {
                url.stopAccessingSecurityScopedResource()
            }
            self.acquired.removeAll()
        }
    }

    // MARK: - Helpers

    private func findEntry(byPath path: String) -> Entry? {
        let canonical = URL(fileURLWithPath: path).standardizedFileURL.path
        let entries = loadEntries()
        let matches: (String) -> Bool = { candidate in
            candidate == path
                || URL(fileURLWithPath: candidate).standardizedFileURL.path == canonical
        }
        if let current = entries.first(where: { matches($0.lastResolvedPath) }) {
            return current
        }
        return entries.first(where: { e in e.previousPaths.contains(where: matches) })
    }

    private func deriveDisplayName(_ url: URL) -> String {
        // Prefer the system localizedName ("Downloads" rather than "downloads")
        if let values = try? url.resourceValues(forKeys: [.localizedNameKey]),
           let name = values.localizedName, !name.isEmpty {
            return name
        }
        let last = url.lastPathComponent
        return last.isEmpty ? url.path : last
    }

    private func isUbiquitous(_ url: URL) -> Bool {
        if let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey]),
           let flag = values.isUbiquitousItem {
            return flag
        }
        return false
    }

    private func jsonString(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return nil
        }
        return str
    }

    private func topPresentingViewController() -> UIViewController? {
        var window: UIWindow?
        if #available(iOS 13.0, *) {
            window = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first(where: { $0.isKeyWindow })
        }
        if window == nil {
            window = UIApplication.shared.windows.first(where: { $0.isKeyWindow })
                ?? UIApplication.shared.windows.first
        }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
    private let onPick: ([URL]) -> Void
    var onComplete: (() -> Void)?

    init(onPick: @escaping ([URL]) -> Void) {
        self.onPick = onPick
    }

    func documentPicker(_ controller: UIDocumentPickerViewController,
                        didPickDocumentsAt urls: [URL]) {
        onPick(urls)
        onComplete?()
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        onPick([])
        onComplete?()
    }
}
