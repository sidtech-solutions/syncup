#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>
#include <jsi/jsi.h>

#ifdef RCT_NEW_ARCH_ENABLED
#include "GoServerBridgeSpecJSI.h"

class GoServerBridgeImpl : public facebook::react::NativeGoServerBridgeCxxSpec<GoServerBridgeImpl> {
public:
    GoServerBridgeImpl(std::shared_ptr<facebook::react::CallInvoker> jsInvoker);

    double startServer(facebook::jsi::Runtime &rt);
    bool stopServer(facebook::jsi::Runtime &rt);
    double getServerPort(facebook::jsi::Runtime &rt);
    facebook::jsi::String getApiKey(facebook::jsi::Runtime &rt);
    facebook::jsi::String getDeviceId(facebook::jsi::Runtime &rt);
    facebook::jsi::String getGuiAddress(facebook::jsi::Runtime &rt);
    facebook::jsi::String getDataDir(facebook::jsi::Runtime &rt);
    facebook::jsi::String listSubdirs(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    facebook::jsi::String mkdirSubdir(facebook::jsi::Runtime &rt, facebook::jsi::String parent, facebook::jsi::String name);
    facebook::jsi::String removeDir(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    facebook::jsi::String copyFile(facebook::jsi::Runtime &rt, facebook::jsi::String src, facebook::jsi::String dst);
    facebook::jsi::String resolvePath(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    facebook::jsi::String zipDir(facebook::jsi::Runtime &rt, facebook::jsi::String srcDir, facebook::jsi::String dstPath);
    void setSuspended(facebook::jsi::Runtime &rt, bool suspended);
    bool getWifiOnlySync(facebook::jsi::Runtime &rt);
    bool setWifiOnlySync(facebook::jsi::Runtime &rt, bool enabled);
    bool getChargingOnlySync(facebook::jsi::Runtime &rt);
    bool setChargingOnlySync(facebook::jsi::Runtime &rt, bool enabled);
    bool getContinuousBackgroundSync(facebook::jsi::Runtime &rt);
    bool setContinuousBackgroundSync(facebook::jsi::Runtime &rt, bool enabled);
    bool getAllowMeteredWifi(facebook::jsi::Runtime &rt);
    bool setAllowMeteredWifi(facebook::jsi::Runtime &rt, bool enabled);
    bool getAllowMobileData(facebook::jsi::Runtime &rt);
    bool setAllowMobileData(facebook::jsi::Runtime &rt, bool enabled);
    bool openBatteryOptimizationSettings(facebook::jsi::Runtime &rt);
    bool isIgnoringBatteryOptimizations(facebook::jsi::Runtime &rt);
    bool openFolderInFileManager(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    facebook::jsi::String getFoldersRoot(facebook::jsi::Runtime &rt);
    bool setFoldersRoot(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    bool maybeNotifyFolderErrors(facebook::jsi::Runtime &rt,
                                 facebook::jsi::String folderId,
                                 double count,
                                 facebook::jsi::String label,
                                 facebook::jsi::String sampleError);
    void setVaultRegistry(facebook::jsi::Runtime &rt, facebook::jsi::String json);
    bool getExternalControlEnabled(facebook::jsi::Runtime &rt);
    bool setExternalControlEnabled(facebook::jsi::Runtime &rt, bool enabled);
    bool getStartOnBoot(facebook::jsi::Runtime &rt);
    bool setStartOnBoot(facebook::jsi::Runtime &rt, bool enabled);
    // External (user-picked) folder access. Cross-platform; on Android backed
    // by SAF, on iOS by UIDocumentPicker + security-scoped bookmarks.
    facebook::jsi::String pickExternalFolder(facebook::jsi::Runtime &rt);
    facebook::jsi::String getPersistedExternalFolders(facebook::jsi::Runtime &rt);
    bool revokeExternalFolder(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    facebook::jsi::String getExternalFolderDisplayName(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    bool validateExternalFolder(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    // Android-only: copy a SAF-backed file to the cache dir so the RN preview
    // modal can load it via file:// URI. iOS path is a no-op (file is already
    // a real path once scope is held).
    facebook::jsi::String copySafFileToCache(facebook::jsi::Runtime &rt, facebook::jsi::String treeURI, facebook::jsi::String relativePath);
    // Android-only: MANAGE_EXTERNAL_STORAGE gate + POSIX dir browser. iOS stubs
    // these out (hasAllFilesAccess returns true so JS skips the request flow).
    bool hasAllFilesAccess(facebook::jsi::Runtime &rt);
    bool requestAllFilesAccess(facebook::jsi::Runtime &rt);
    facebook::jsi::String listLocalSubdirs(facebook::jsi::Runtime &rt, facebook::jsi::String path);
    facebook::jsi::String mkdirLocalSubdir(facebook::jsi::Runtime &rt, facebook::jsi::String parent, facebook::jsi::String name);
    facebook::jsi::String getExternalStorageRoot(facebook::jsi::Runtime &rt);
    // iOS-only: present QLPreviewController on a list of local file paths.
    void previewFileNative(facebook::jsi::Runtime &rt, facebook::jsi::String pathsJson, double startIndex);
    // Backup / restore. Returns JSON (see NativeGoServerBridge.ts).
    facebook::jsi::String exportConfig(facebook::jsi::Runtime &rt, facebook::jsi::String asyncStorageJson);
    facebook::jsi::String importConfig(facebook::jsi::Runtime &rt, facebook::jsi::String password);
    facebook::jsi::String getSystemLog(facebook::jsi::Runtime &rt, facebook::jsi::String since, double limit);
    facebook::jsi::String writeSystemLog(facebook::jsi::Runtime &rt, facebook::jsi::String dstPath);
};
#endif

@interface GoServerBridge : NSObject <RCTBridgeModule, RCTTurboModule>

@end
