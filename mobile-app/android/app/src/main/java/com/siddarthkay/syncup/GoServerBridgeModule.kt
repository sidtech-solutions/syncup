package com.siddarthkay.syncup

import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

import gobridge.MobileAPI

@ReactModule(name = GoServerBridgeModule.NAME)
class GoServerBridgeModule(reactContext: ReactApplicationContext) :
    NativeGoServerBridgeSpec(reactContext) {

    companion object {
        const val NAME = "GoServerBridge"

        init {
            System.loadLibrary("gojni")
        }
    }

    private val mobileAPI = MobileAPI()
    private val ctx = reactContext
    private val safProvider = SAFProvider(reactContext.applicationContext)

    init {
        // Wire the SAF bridge so Go's "saf" filesystem type can call through to Kotlin.
        mobileAPI.setSAFBridge(safProvider)
    }

    override fun getName(): String = NAME

    override fun startServer(): Double {
        return try {
            // safe to re-enter; Android coalesces duplicate startForegroundService.
            SyncthingService.start(ctx)
            // go side is idempotent via globalClient. stash foldersRoot first
            // so a JS-triggered restart still hits the Load migration path.
            val dataDir = Paths.syncthingDir(ctx)
            val foldersRoot = Paths.foldersRoot(ctx)
            mobileAPI.setFoldersRoot(foldersRoot)
            mobileAPI.startServer(dataDir).toDouble()
        } catch (e: Exception) {
            android.util.Log.e(NAME, "startServer failed", e)
            0.0
        }
    }

    override fun stopServer(): Boolean {
        return try {
            SyncthingService.stop(ctx)
            true
        } catch (e: Exception) {
            false
        }
    }

    override fun getServerPort(): Double {
        return try {
            mobileAPI.getServerPort().toDouble()
        } catch (e: Exception) {
            0.0
        }
    }

    override fun getApiKey(): String {
        return try {
            mobileAPI.getAPIKey() ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    override fun getDeviceId(): String {
        return try {
            mobileAPI.getDeviceID() ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    override fun getGuiAddress(): String {
        return try {
            mobileAPI.getGUIAddress() ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    override fun getDataDir(): String {
        return try {
            mobileAPI.getDataDir() ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    override fun listSubdirs(path: String): String {
        return try {
            mobileAPI.listSubdirs(path) ?: "{\"error\":\"nil result\"}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "listSubdirs failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    override fun mkdirSubdir(parent: String, name: String): String {
        return try {
            mobileAPI.mkdirSubdir(parent, name) ?: "{\"error\":\"nil result\"}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "mkdirSubdir failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    override fun removeDir(path: String): String {
        return try {
            mobileAPI.removeDir(path) ?: "{\"error\":\"nil result\"}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "removeDir failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    override fun copyFile(src: String, dst: String): String {
        return try {
            mobileAPI.copyFile(src, dst) ?: "{\"error\":\"nil result\"}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "copyFile failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    override fun resolvePath(path: String): String {
        return try {
            mobileAPI.resolvePath(path) ?: "{\"error\":\"nil result\"}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "resolvePath failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    override fun zipDir(srcDir: String, dstPath: String): String {
        return try {
            mobileAPI.zipDir(srcDir, dstPath) ?: "{\"error\":\"nil result\"}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "zipDir failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    override fun setSuspended(suspended: Boolean) {
        try {
            mobileAPI.setSuspended(suspended)
        } catch (e: Exception) {
            android.util.Log.e(NAME, "setSuspended failed", e)
        }
    }

    override fun getWifiOnlySync(): Boolean {
        return SyncthingPrefs.getWifiOnlySync(ctx)
    }

    override fun setWifiOnlySync(enabled: Boolean): Boolean {
        SyncthingPrefs.setWifiOnlySync(ctx, enabled)
        try {
            SyncthingService.requestConditionEvaluation(ctx)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "requestConditionEvaluation failed", e)
        }
        return true
    }

    // iOS-only behaviour; on Android the foreground service already keeps the
    // daemon resident, so we just persist the flag for settings parity.
    override fun getContinuousBackgroundSync(): Boolean {
        return SyncthingPrefs.getContinuousBackgroundSync(ctx)
    }

    override fun setContinuousBackgroundSync(enabled: Boolean): Boolean {
        SyncthingPrefs.setContinuousBackgroundSync(ctx, enabled)
        return SyncthingPrefs.getContinuousBackgroundSync(ctx)
    }

    override fun getChargingOnlySync(): Boolean {
        return SyncthingPrefs.getChargingOnlySync(ctx)
    }

    override fun setChargingOnlySync(enabled: Boolean): Boolean {
        SyncthingPrefs.setChargingOnlySync(ctx, enabled)
        try {
            SyncthingService.requestConditionEvaluation(ctx)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "requestConditionEvaluation failed", e)
        }
        return true
    }

    override fun getAllowMeteredWifi(): Boolean {
        return SyncthingPrefs.getAllowMeteredWifi(ctx)
    }

    override fun setAllowMeteredWifi(enabled: Boolean): Boolean {
        SyncthingPrefs.setAllowMeteredWifi(ctx, enabled)
        try {
            SyncthingService.requestConditionEvaluation(ctx)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "requestConditionEvaluation failed", e)
        }
        return true
    }

    override fun getAllowMobileData(): Boolean {
        return SyncthingPrefs.getAllowMobileData(ctx)
    }

    override fun setAllowMobileData(enabled: Boolean): Boolean {
        SyncthingPrefs.setAllowMobileData(ctx, enabled)
        try {
            SyncthingService.requestConditionEvaluation(ctx)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "requestConditionEvaluation failed", e)
        }
        return true
    }

    override fun isIgnoringBatteryOptimizations(): Boolean {
        return try {
            val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            pm.isIgnoringBatteryOptimizations(ctx.packageName)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "isIgnoringBatteryOptimizations failed", e)
            false
        }
    }

    override fun openBatteryOptimizationSettings(): Boolean {
        val pkgUri = android.net.Uri.parse("package:" + ctx.packageName)
        val direct = android.content.Intent(
            android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            pkgUri
        ).apply { flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK }
        try {
            ctx.startActivity(direct)
            return true
        } catch (e: Exception) {
            android.util.Log.w(NAME, "ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS unavailable, falling back", e)
        }
        return try {
            val fallback = android.content.Intent(
                android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
            )
            fallback.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
            ctx.startActivity(fallback)
            true
        } catch (e: Exception) {
            android.util.Log.e(NAME, "openBatteryOptimizationSettings failed", e)
            false
        }
    }

    override fun getFoldersRoot(): String {
        return try {
            mobileAPI.getFoldersRoot() ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    override fun setFoldersRoot(path: String): Boolean {
        return try {
            mobileAPI.setFoldersRoot(path)
        } catch (e: Exception) {
            android.util.Log.e(NAME, "setFoldersRoot failed", e)
            false
        }
    }

    override fun maybeNotifyFolderErrors(
        folderId: String,
        count: Double,
        label: String,
        sampleError: String,
    ): Boolean {
        return NotificationDedup.maybeNotifyFolderErrors(
            ctx,
            folderId,
            count.toInt(),
            label,
            sampleError,
        )
    }

    // Persist the JS-side vault registry into SharedPreferences and ask the
    // foreground service to rebuild its notification. iOS sends a fresh
    // local notification when a vault goes stale; Android instead surfaces
    // "N vaults stale" in the persistent service notification — same data,
    // different transport, matching each platform's notification idioms.
    override fun setVaultRegistry(json: String) {
        try {
            VaultRegistry.setPayload(ctx, json)
            SyncthingService.refreshNotification(ctx)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "setVaultRegistry failed", e)
        }
    }

    override fun getExternalControlEnabled(): Boolean {
        return SyncthingPrefs.getExternalControlEnabled(ctx)
    }

    override fun setExternalControlEnabled(enabled: Boolean): Boolean {
        SyncthingPrefs.setExternalControlEnabled(ctx, enabled)
        return SyncthingPrefs.getExternalControlEnabled(ctx)
    }

    override fun getStartOnBoot(): Boolean {
        return SyncthingPrefs.getStartOnBoot(ctx)
    }

    override fun setStartOnBoot(enabled: Boolean): Boolean {
        SyncthingPrefs.setStartOnBoot(ctx, enabled)
        return SyncthingPrefs.getStartOnBoot(ctx)
    }

    override fun pickExternalFolder(): String {
        // Launch the system SAF folder picker synchronously from the JS thread.
        // The picker UX is the same regardless of permission state; what changes
        // is what we store. With MANAGE_EXTERNAL_STORAGE granted we convert the
        // returned tree URI to a POSIX path so syncthing can use the regular
        // 'basic' filesystem driver (inotify watcher, no JNI per-file overhead).
        // Without it, we fall back to taking persistable URI permission and
        // storing the SAF tree URI for the 'saf' filesystem driver.
        val activity = ctx.currentActivity as? MainActivity
            ?: return ""
        val uri = activity.pickSafFolderBlocking() ?: return ""
        val uriString = uri.toString()
        val displayName = try {
            safProvider.getDisplayName(uriString)
        } catch (e: Exception) {
            uriString
        }
        val posixPath = if (hasAllFilesAccess()) tryConvertTreeUriToPosix(uri) else null
        return if (posixPath != null) {
            // POSIX-backed: skip SAF persistence; the path is reachable via
            // direct filesystem APIs as long as the permission is held.
            org.json.JSONObject().apply {
                put("ok", true)
                put("id", posixPath)
                put("path", posixPath)
                put("displayName", displayName)
                put("isUbiquitous", false)
            }.toString()
        } else {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            ctx.contentResolver.takePersistableUriPermission(uri, flags)
            org.json.JSONObject().apply {
                put("ok", true)
                put("id", uriString)
                put("path", uriString)
                put("displayName", displayName)
                put("isUbiquitous", false)
            }.toString()
        }
    }

    /**
     * Resolve a SAF tree URI under primary external storage (or a known SD-card
     * volume) to its POSIX path. Returns null for cloud DocumentsProviders or
     * any URI we can't safely map. Caller must hold MANAGE_EXTERNAL_STORAGE for
     * the returned path to actually be readable.
     */
    private fun tryConvertTreeUriToPosix(uri: android.net.Uri): String? {
        return try {
            // External Storage Documents authority is the only one that maps to
            // /storage/* mount points. Drive/Dropbox/etc. live behind their own
            // authorities and have no POSIX equivalent.
            if (uri.authority != "com.android.externalstorage.documents") return null
            val docId = android.provider.DocumentsContract.getTreeDocumentId(uri) ?: return null
            val parts = docId.split(":", limit = 2)
            if (parts.isEmpty()) return null
            val volume = parts[0]
            val relPath = if (parts.size > 1) parts[1] else ""
            val mountPoint = when (volume) {
                "primary" -> android.os.Environment.getExternalStorageDirectory().absolutePath
                else -> "/storage/$volume"
            }
            val full = if (relPath.isEmpty()) mountPoint else "$mountPoint/$relPath"
            if (java.io.File(full).exists()) full else null
        } catch (e: Exception) {
            android.util.Log.w(NAME, "tryConvertTreeUriToPosix failed", e)
            null
        }
    }

    override fun getPersistedExternalFolders(): String {
        return try {
            val perms = ctx.contentResolver.persistedUriPermissions
            val arr = org.json.JSONArray()
            for (p in perms) {
                val uriString = p.uri.toString()
                val displayName = try {
                    safProvider.getDisplayName(uriString)
                } catch (e: Exception) {
                    uriString
                }
                val obj = org.json.JSONObject().apply {
                    put("id", uriString)
                    put("path", uriString)
                    put("displayName", displayName)
                    // Android's permission model doesn't surface "stale" the way
                    // iOS bookmarks do; revoked permissions just disappear from
                    // persistedUriPermissions, so anything in the list is live.
                    put("isStale", false)
                }
                arr.put(obj)
            }
            arr.toString()
        } catch (e: Exception) {
            "[]"
        }
    }

    override fun revokeExternalFolder(path: String): Boolean {
        return try {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            ctx.contentResolver.releasePersistableUriPermission(Uri.parse(path), flags)
            true
        } catch (e: Exception) {
            android.util.Log.e(NAME, "revokeExternalFolder failed", e)
            false
        }
    }

    override fun getExternalFolderDisplayName(path: String): String {
        return try {
            safProvider.getDisplayName(path)
        } catch (e: Exception) {
            android.util.Log.e(NAME, "getExternalFolderDisplayName failed", e)
            path
        }
    }

    override fun copySafFileToCache(treeURI: String, relativePath: String): String {
        return try {
            val treeUri = android.net.Uri.parse(treeURI)
            // Resolve the document ID and build the document URI
            val fd = safProvider.openFd(treeURI, relativePath, "r")
            val input = java.io.FileInputStream(java.io.FileDescriptor().also {
                // Use ParcelFileDescriptor to wrap the fd for proper stream creation
            })
            // Simpler: re-open through the provider to get an InputStream
            val pfd = android.os.ParcelFileDescriptor.adoptFd(fd.toInt())
            val inputStream = java.io.FileInputStream(pfd.fileDescriptor)

            // Write to cache dir preserving the filename
            val fileName = relativePath.substringAfterLast('/')
            val cacheFile = java.io.File(ctx.cacheDir, "saf-preview/$fileName")
            cacheFile.parentFile?.mkdirs()
            cacheFile.outputStream().use { out ->
                inputStream.use { inp -> inp.copyTo(out) }
            }
            pfd.close()
            cacheFile.absolutePath
        } catch (e: Exception) {
            android.util.Log.e(NAME, "copySafFileToCache failed", e)
            ""
        }
    }

    override fun validateExternalFolder(path: String): Boolean {
        return try {
            mobileAPI.validateSAFPermission(path)
        } catch (e: Exception) {
            android.util.Log.e(NAME, "validateExternalFolder failed", e)
            false
        }
    }

    override fun listLocalSubdirs(path: String): String {
        return try {
            val dir = java.io.File(path)
            if (!dir.exists()) {
                return org.json.JSONObject().apply {
                    put("error", "no such directory: $path")
                }.toString()
            }
            if (!dir.isDirectory) {
                return org.json.JSONObject().apply {
                    put("error", "not a directory: $path")
                }.toString()
            }
            val children = dir.listFiles() ?: emptyArray()
            val arr = org.json.JSONArray()
            for (child in children) {
                if (child.isHidden) continue
                arr.put(
                    org.json.JSONObject().apply {
                        put("name", child.name)
                        put("isDir", child.isDirectory)
                        put("size", if (child.isDirectory) 0 else child.length())
                        // RFC3339 to match the Go-side listSubdirs shape so JS
                        // consumers don't have to branch on source.
                        put(
                            "modTime",
                            try {
                                java.text.SimpleDateFormat(
                                    "yyyy-MM-dd'T'HH:mm:ssXXX",
                                    java.util.Locale.US,
                                ).format(java.util.Date(child.lastModified()))
                            } catch (e: Exception) {
                                ""
                            },
                        )
                    },
                )
            }
            org.json.JSONObject().apply {
                put("path", dir.absolutePath)
                put("entries", arr)
            }.toString()
        } catch (e: SecurityException) {
            org.json.JSONObject().apply {
                put("error", "permission denied: ${e.message}")
            }.toString()
        } catch (e: Exception) {
            android.util.Log.e(NAME, "listLocalSubdirs failed", e)
            org.json.JSONObject().apply {
                put("error", e.message ?: "unknown error")
            }.toString()
        }
    }

    override fun mkdirLocalSubdir(parent: String, name: String): String {
        return try {
            val parentDir = java.io.File(parent)
            if (!parentDir.exists() || !parentDir.isDirectory) {
                return org.json.JSONObject().apply {
                    put("error", "parent is not a directory: $parent")
                }.toString()
            }
            // Block path-traversal: name must be a single component.
            if (name.contains('/') || name == "." || name == "..") {
                return org.json.JSONObject().apply {
                    put("error", "invalid folder name: $name")
                }.toString()
            }
            val target = java.io.File(parentDir, name)
            if (target.exists()) {
                if (!target.isDirectory) {
                    return org.json.JSONObject().apply {
                        put("error", "a file with that name already exists")
                    }.toString()
                }
            } else if (!target.mkdir()) {
                return org.json.JSONObject().apply {
                    put("error", "could not create folder")
                }.toString()
            }
            org.json.JSONObject().apply {
                put("path", target.absolutePath)
            }.toString()
        } catch (e: SecurityException) {
            org.json.JSONObject().apply {
                put("error", "permission denied: ${e.message}")
            }.toString()
        } catch (e: Exception) {
            android.util.Log.e(NAME, "mkdirLocalSubdir failed", e)
            org.json.JSONObject().apply {
                put("error", e.message ?: "unknown error")
            }.toString()
        }
    }

    override fun getExternalStorageRoot(): String {
        return android.os.Environment.getExternalStorageDirectory().absolutePath
    }

    override fun hasAllFilesAccess(): Boolean {
        // Pre-API-30 devices have always-broad external storage; treat as "granted".
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return true
        return android.os.Environment.isExternalStorageManager()
    }

    override fun requestAllFilesAccess(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return false
        // Per-app screen first; some OEMs only ship the global one, so fall back.
        return try {
            val pkgUri = android.net.Uri.parse("package:" + ctx.packageName)
            val direct = android.content.Intent(
                android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                pkgUri,
            ).apply { flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK }
            try {
                ctx.startActivity(direct)
                true
            } catch (e: android.content.ActivityNotFoundException) {
                val fallback = android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION,
                ).apply { flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK }
                ctx.startActivity(fallback)
                true
            }
        } catch (e: Exception) {
            android.util.Log.e(NAME, "requestAllFilesAccess failed", e)
            false
        }
    }

    override fun previewFileNative(pathsJson: String, startIndex: Double) {
        // No-op on Android; the JS-side FilePreviewModal handles preview.
        // Spec is shared cross-platform so we accept the call but ignore it.
    }

    override fun exportConfig(asyncStorageJson: String): String {
        val activity = ctx.currentActivity as? MainActivity
            ?: return jsonError("activity not available")
        val suggested = "syncup-backup-${java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(java.util.Date())}.zip"
        val uri = activity.pickBackupSaveBlocking(suggested) ?: return ""
        val cache = java.io.File(ctx.cacheDir, "backup-export.zip")
        val prefsCache = java.io.File(ctx.cacheDir, "syncup-prefs.json")
        val asyncCache = java.io.File(ctx.cacheDir, "syncup-async.json")
        try {
            cache.delete()
            prefsCache.delete()
            asyncCache.delete()
            prefsCache.writeText(SyncthingPrefs.exportAsJson(ctx))

            val extras = org.json.JSONArray().apply {
                put(org.json.JSONObject().apply {
                    put("name", "syncup-prefs.json")
                    put("path", prefsCache.absolutePath)
                })
                if (asyncStorageJson.isNotEmpty() && asyncStorageJson != "{}") {
                    asyncCache.writeText(asyncStorageJson)
                    put(org.json.JSONObject().apply {
                        put("name", "syncup-async.json")
                        put("path", asyncCache.absolutePath)
                    })
                }
            }.toString()

            val result = mobileAPI.exportConfig("", cache.absolutePath, extras)
                ?: return jsonError("nil result")
            val obj = org.json.JSONObject(result)
            if (obj.has("error")) return jsonError(obj.optString("error", "export failed"))

            ctx.contentResolver.openOutputStream(uri, "wt")?.use { out ->
                java.io.FileInputStream(cache).use { input ->
                    input.copyTo(out)
                }
            } ?: return jsonError("could not open output stream")

            val displayName = queryDisplayName(uri) ?: uri.lastPathSegment ?: suggested
            return org.json.JSONObject().apply {
                put("ok", true)
                put("path", uri.toString())
                put("displayName", displayName)
            }.toString()
        } catch (e: Exception) {
            android.util.Log.e(NAME, "exportConfig failed", e)
            return jsonError(e.message ?: "export failed")
        } finally {
            cache.delete()
            prefsCache.delete()
            asyncCache.delete()
        }
    }

    override fun importConfig(password: String): String {
        val activity = ctx.currentActivity as? MainActivity
            ?: return jsonError("activity not available")
        val uri = activity.pickBackupOpenBlocking() ?: return ""
        val cache = java.io.File(ctx.cacheDir, "backup-import.zip")
        try {
            cache.delete()
            ctx.contentResolver.openInputStream(uri)?.use { input ->
                java.io.FileOutputStream(cache).use { out ->
                    input.copyTo(out)
                }
            } ?: return jsonError("could not open input stream")

            val dataDir = Paths.syncthingDir(ctx)
            val result = mobileAPI.importConfig(cache.absolutePath, dataDir, password)
                ?: return jsonError("nil result")
            val obj = org.json.JSONObject(result)
            if (obj.has("error")) return jsonError(obj.optString("error", "import failed"))

            var prefsImported = false
            if (obj.optBoolean("importedPrefs", false)) {
                val prefsFile = java.io.File(dataDir, "syncup-prefs.json")
                if (prefsFile.exists()) {
                    prefsImported = try {
                        SyncthingPrefs.importFromJson(ctx, prefsFile.readText())
                        true
                    } catch (e: Exception) {
                        android.util.Log.e(NAME, "prefs import failed", e)
                        false
                    } finally {
                        prefsFile.delete()
                    }
                }
            }

            var asyncJson = ""
            if (obj.optBoolean("importedAsync", false)) {
                val asyncFile = java.io.File(dataDir, "syncup-async.json")
                if (asyncFile.exists()) {
                    try {
                        asyncJson = asyncFile.readText()
                    } catch (e: Exception) {
                        android.util.Log.e(NAME, "async read failed", e)
                    } finally {
                        asyncFile.delete()
                    }
                }
            }

            return org.json.JSONObject().apply {
                put("ok", true)
                put("path", dataDir)
                put("displayName", queryDisplayName(uri) ?: uri.lastPathSegment ?: "")
                put("importedPrefs", prefsImported)
                put("asyncStorageJson", asyncJson)
            }.toString()
        } catch (e: Exception) {
            android.util.Log.e(NAME, "importConfig failed", e)
            return jsonError(e.message ?: "import failed")
        } finally {
            cache.delete()
        }
    }

    override fun getSystemLog(since: String, limit: Double): String {
        return try {
            mobileAPI.getSystemLog(since, limit.toLong()) ?: "{\"messages\":[]}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "getSystemLog failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    override fun writeSystemLog(dstPath: String): String {
        return try {
            mobileAPI.writeSystemLog(dstPath) ?: "{\"error\":\"nil result\"}"
        } catch (e: Exception) {
            android.util.Log.e(NAME, "writeSystemLog failed", e)
            "{\"error\":\"${e.message}\"}"
        }
    }

    private fun jsonError(msg: String): String =
        org.json.JSONObject().apply {
            put("ok", false)
            put("error", msg)
        }.toString()

    private fun queryDisplayName(uri: Uri): String? = try {
        ctx.contentResolver.query(
            uri,
            arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
            null, null, null,
        )?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    override fun openFolderInFileManager(path: String): Boolean {
        // "primary:" in DocumentsUI maps to /storage/emulated/0, so a
        // tree URI under the app-scoped path resolves fine.
        return try {
            val externalRoot = android.os.Environment.getExternalStorageDirectory().absolutePath
            if (!path.startsWith(externalRoot)) {
                android.util.Log.w(NAME, "openFolderInFileManager: path not under external root: $path")
                return false
            }
            val relative = path.removePrefix(externalRoot).removePrefix("/")
            val docId = "primary:$relative"
            val treeUri = android.provider.DocumentsContract.buildTreeDocumentUri(
                "com.android.externalstorage.documents",
                docId,
            )
            // some file managers / OEM DocumentsUI handle ACTION_VIEW on a tree URI.
            val viewIntent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(treeUri, "vnd.android.document/directory")
                addFlags(
                    android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        android.content.Intent.FLAG_ACTIVITY_NEW_TASK,
                )
            }
            try {
                ctx.startActivity(viewIntent)
                return true
            } catch (e: android.content.ActivityNotFoundException) {
                android.util.Log.w(NAME, "ACTION_VIEW for directory not handled, falling back to OPEN_DOCUMENT_TREE", e)
            }
            // fallback is a picker, not a viewer, but it's universally available.
            val pickerIntent = android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, treeUri)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(pickerIntent)
            true
        } catch (e: Exception) {
            android.util.Log.e(NAME, "openFolderInFileManager failed", e)
            false
        }
    }
}
