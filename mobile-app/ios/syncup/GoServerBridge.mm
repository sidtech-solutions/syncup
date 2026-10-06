#import "GoServerBridge.h"
#import "GoBridgeWrapper.h"
#import <react/bridging/Bridging.h>

#ifdef RCT_NEW_ARCH_ENABLED
GoServerBridgeImpl::GoServerBridgeImpl(std::shared_ptr<facebook::react::CallInvoker> jsInvoker)
    : NativeGoServerBridgeCxxSpec(std::move(jsInvoker)) {}

double GoServerBridgeImpl::startServer(facebook::jsi::Runtime &rt) {
    NSNumber *result = [GoBridgeWrapper startServer];
    return [result doubleValue];
}

bool GoServerBridgeImpl::stopServer(facebook::jsi::Runtime &rt) {
    NSNumber *result = [GoBridgeWrapper stopServer];
    return [result boolValue];
}

double GoServerBridgeImpl::getServerPort(facebook::jsi::Runtime &rt) {
    NSNumber *result = [GoBridgeWrapper getServerPort];
    return [result doubleValue];
}

facebook::jsi::String GoServerBridgeImpl::getApiKey(facebook::jsi::Runtime &rt) {
    NSString *result = [GoBridgeWrapper getApiKey];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::getDeviceId(facebook::jsi::Runtime &rt) {
    NSString *result = [GoBridgeWrapper getDeviceId];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::getGuiAddress(facebook::jsi::Runtime &rt) {
    NSString *result = [GoBridgeWrapper getGuiAddress];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::getDataDir(facebook::jsi::Runtime &rt) {
    NSString *result = [GoBridgeWrapper getDataDir];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::listSubdirs(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper listSubdirs:p];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::mkdirSubdir(facebook::jsi::Runtime &rt, facebook::jsi::String parent, facebook::jsi::String name) {
    NSString *p = [NSString stringWithUTF8String:parent.utf8(rt).c_str()];
    NSString *n = [NSString stringWithUTF8String:name.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper mkdirSubdir:p name:n];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::removeDir(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper removeDir:p];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::copyFile(facebook::jsi::Runtime &rt, facebook::jsi::String src, facebook::jsi::String dst) {
    NSString *s = [NSString stringWithUTF8String:src.utf8(rt).c_str()];
    NSString *d = [NSString stringWithUTF8String:dst.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper copyFile:s dst:d];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::resolvePath(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper resolvePath:p];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::zipDir(facebook::jsi::Runtime &rt, facebook::jsi::String srcDir, facebook::jsi::String dstPath) {
    NSString *s = [NSString stringWithUTF8String:srcDir.utf8(rt).c_str()];
    NSString *d = [NSString stringWithUTF8String:dstPath.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper zipDir:s dstPath:d];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

void GoServerBridgeImpl::setSuspended(facebook::jsi::Runtime &rt, bool suspended) {
    [GoBridgeWrapper setSuspended:(suspended ? YES : NO)];
}

bool GoServerBridgeImpl::getWifiOnlySync(facebook::jsi::Runtime &rt) {
    return [GoBridgeWrapper getWifiOnlySync];
}

bool GoServerBridgeImpl::setWifiOnlySync(facebook::jsi::Runtime &rt, bool enabled) {
    return [GoBridgeWrapper setWifiOnlySync:(enabled ? YES : NO)];
}

bool GoServerBridgeImpl::getChargingOnlySync(facebook::jsi::Runtime &rt) {
    return [GoBridgeWrapper getChargingOnlySync];
}

bool GoServerBridgeImpl::setChargingOnlySync(facebook::jsi::Runtime &rt, bool enabled) {
    return [GoBridgeWrapper setChargingOnlySync:(enabled ? YES : NO)];
}

bool GoServerBridgeImpl::getContinuousBackgroundSync(facebook::jsi::Runtime &rt) {
    return [GoBridgeWrapper getContinuousBackgroundSync];
}

bool GoServerBridgeImpl::setContinuousBackgroundSync(facebook::jsi::Runtime &rt, bool enabled) {
    return [GoBridgeWrapper setContinuousBackgroundSync:(enabled ? YES : NO)];
}

bool GoServerBridgeImpl::getAllowMeteredWifi(facebook::jsi::Runtime &rt) {
    return [[NSUserDefaults standardUserDefaults] boolForKey:@"syncthing.allowMeteredWifi"];
}

bool GoServerBridgeImpl::setAllowMeteredWifi(facebook::jsi::Runtime &rt, bool enabled) {
    [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:@"syncthing.allowMeteredWifi"];
    return true;
}

bool GoServerBridgeImpl::getAllowMobileData(facebook::jsi::Runtime &rt) {
    return [[NSUserDefaults standardUserDefaults] boolForKey:@"syncthing.allowMobileData"];
}

bool GoServerBridgeImpl::setAllowMobileData(facebook::jsi::Runtime &rt, bool enabled) {
    [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:@"syncthing.allowMobileData"];
    return true;
}

bool GoServerBridgeImpl::openBatteryOptimizationSettings(facebook::jsi::Runtime &rt) {
    return [GoBridgeWrapper openBatteryOptimizationSettings];
}

bool GoServerBridgeImpl::isIgnoringBatteryOptimizations(facebook::jsi::Runtime &rt) {
    return [GoBridgeWrapper isIgnoringBatteryOptimizations];
}

bool GoServerBridgeImpl::openFolderInFileManager(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    return [GoBridgeWrapper openFolderInFileManager:p];
}

facebook::jsi::String GoServerBridgeImpl::getFoldersRoot(facebook::jsi::Runtime &rt) {
    NSString *result = [GoBridgeWrapper getFoldersRoot];
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

bool GoServerBridgeImpl::setFoldersRoot(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    return [GoBridgeWrapper setFoldersRoot:p];
}

bool GoServerBridgeImpl::maybeNotifyFolderErrors(facebook::jsi::Runtime &rt,
                                                 facebook::jsi::String folderId,
                                                 double count,
                                                 facebook::jsi::String label,
                                                 facebook::jsi::String sampleError) {
    // fg path; BG path shares the UserDefaults dedup store via the same wrapper.
    NSString *fid = [NSString stringWithUTF8String:folderId.utf8(rt).c_str()];
    NSString *lbl = [NSString stringWithUTF8String:label.utf8(rt).c_str()];
    NSString *smp = [NSString stringWithUTF8String:sampleError.utf8(rt).c_str()];
    return [GoBridgeWrapper maybeNotifyFolderErrorsWithFolderId:fid
                                                          count:(NSInteger)count
                                                          label:lbl
                                                         sample:smp];
}

void GoServerBridgeImpl::setVaultRegistry(facebook::jsi::Runtime &rt, facebook::jsi::String json) {
    NSString *s = [NSString stringWithUTF8String:json.utf8(rt).c_str()];
    [GoBridgeWrapper setVaultRegistryJSON:s];
}

bool GoServerBridgeImpl::getExternalControlEnabled(facebook::jsi::Runtime &rt) {
    // Android-only feature; no AppConfigReceiver-equivalent on iOS.
    return false;
}

bool GoServerBridgeImpl::setExternalControlEnabled(facebook::jsi::Runtime &rt, bool enabled) {
    // No-op on iOS.
    (void)enabled;
    return false;
}

bool GoServerBridgeImpl::getStartOnBoot(facebook::jsi::Runtime &rt) {
    // Android-only: iOS apps cannot launch from cold boot.
    return false;
}

bool GoServerBridgeImpl::setStartOnBoot(facebook::jsi::Runtime &rt, bool enabled) {
    (void)enabled;
    return false;
}

facebook::jsi::String GoServerBridgeImpl::pickExternalFolder(facebook::jsi::Runtime &rt) {
    NSString *result = [GoBridgeWrapper pickExternalFolder] ?: @"";
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::getPersistedExternalFolders(facebook::jsi::Runtime &rt) {
    NSString *result = [GoBridgeWrapper getPersistedExternalFolders] ?: @"[]";
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

bool GoServerBridgeImpl::revokeExternalFolder(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    return [GoBridgeWrapper revokeExternalFolder:p];
}

facebook::jsi::String GoServerBridgeImpl::getExternalFolderDisplayName(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper getExternalFolderDisplayName:p] ?: @"";
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

bool GoServerBridgeImpl::validateExternalFolder(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    NSString *p = [NSString stringWithUTF8String:path.utf8(rt).c_str()];
    return [GoBridgeWrapper validateExternalFolder:p];
}

// Android-specific gate; iOS has no equivalent so the JS side reads `true`
// to mean "skip the request flow entirely."
bool GoServerBridgeImpl::hasAllFilesAccess(facebook::jsi::Runtime &rt) {
    return true;
}

bool GoServerBridgeImpl::requestAllFilesAccess(facebook::jsi::Runtime &rt) {
    return false;
}

// Android-only POSIX dir listing for the All-Files-Access browser. iOS has
// no equivalent flow; return an error so any accidental call fails loudly.
facebook::jsi::String GoServerBridgeImpl::listLocalSubdirs(facebook::jsi::Runtime &rt, facebook::jsi::String path) {
    (void)path;
    return facebook::jsi::String::createFromUtf8(rt, "{\"error\":\"unsupported on iOS\"}");
}

facebook::jsi::String GoServerBridgeImpl::mkdirLocalSubdir(facebook::jsi::Runtime &rt, facebook::jsi::String parent, facebook::jsi::String name) {
    (void)parent;
    (void)name;
    return facebook::jsi::String::createFromUtf8(rt, "{\"error\":\"unsupported on iOS\"}");
}

// Android-only concept (the All-Files-Access POSIX browser). iOS has no
// equivalent external storage root, so return "" and let JS handle it.
facebook::jsi::String GoServerBridgeImpl::getExternalStorageRoot(facebook::jsi::Runtime &rt) {
    return facebook::jsi::String::createFromUtf8(rt, "");
}

// SAF-specific cache copy; Android delegates to SAFProvider, iOS no-op
// (a scoped folder's path is already a real file URI the RN preview can load).
facebook::jsi::String GoServerBridgeImpl::copySafFileToCache(facebook::jsi::Runtime &rt, facebook::jsi::String treeURI, facebook::jsi::String relativePath) {
    return facebook::jsi::String::createFromUtf8(rt, "");
}

void GoServerBridgeImpl::previewFileNative(facebook::jsi::Runtime &rt, facebook::jsi::String pathsJson, double startIndex) {
    NSString *p = [NSString stringWithUTF8String:pathsJson.utf8(rt).c_str()];
    [GoBridgeWrapper previewFile:p startIndex:(NSInteger)startIndex];
}

facebook::jsi::String GoServerBridgeImpl::exportConfig(facebook::jsi::Runtime &rt, facebook::jsi::String asyncStorageJson) {
    NSString *json = [NSString stringWithUTF8String:asyncStorageJson.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper exportConfig:(json ?: @"{}")] ?: @"";
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::importConfig(facebook::jsi::Runtime &rt, facebook::jsi::String password) {
    NSString *pw = [NSString stringWithUTF8String:password.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper importConfig:(pw ?: @"")] ?: @"";
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::getSystemLog(facebook::jsi::Runtime &rt, facebook::jsi::String since, double limit) {
    NSString *s = [NSString stringWithUTF8String:since.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper getSystemLog:(s ?: @"") limit:(NSInteger)limit] ?: @"";
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}

facebook::jsi::String GoServerBridgeImpl::writeSystemLog(facebook::jsi::Runtime &rt, facebook::jsi::String dstPath) {
    NSString *p = [NSString stringWithUTF8String:dstPath.utf8(rt).c_str()];
    NSString *result = [GoBridgeWrapper writeSystemLog:(p ?: @"")] ?: @"";
    return facebook::jsi::String::createFromUtf8(rt, [result UTF8String]);
}
#endif

@implementation GoServerBridge

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<GoServerBridgeImpl>(params.jsInvoker);
}
#endif

@end
