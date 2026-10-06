#import "GoBridgeWrapper.h"
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

// Forward declarations for the Swift classes we use from this file. We avoid
// importing "syncup-Swift.h" because that umbrella header drags in Expo and
// UIKit Swift declarations whose ObjC-side prerequisites aren't always
// visible in this translation unit — leading to spurious build errors about
// EXExpoAppDelegate / UIApplicationLaunchOptionsKey not being found.
// Methods marked @objc on the Swift side are dispatched via the runtime, so
// these declarations are enough to compile + link.
@interface ScopedFolderStore : NSObject
+ (instancetype _Nonnull)shared;
- (NSString * _Nonnull)pickFolderBlocking;
- (NSString * _Nonnull)getPersistedFoldersJSON;
- (BOOL)validateFolderByPath:(NSString * _Nonnull)path;
- (NSString * _Nonnull)getDisplayNameByPath:(NSString * _Nonnull)path;
- (BOOL)revokeFolderByPath:(NSString * _Nonnull)path;
- (NSDictionary<NSString *, NSString *> * _Nonnull)acquireAll;
- (void)releaseAll;
@end

@interface QuickLookPresenter : NSObject
+ (instancetype _Nonnull)shared;
- (void)presentWithPaths:(NSArray<NSString *> * _Nonnull)paths startIndex:(NSInteger)startIndex;
@end

@interface BackupPicker : NSObject
+ (instancetype _Nonnull)shared;
- (NSString * _Nonnull)exportFileBlockingWithSourcePath:(NSString * _Nonnull)sourcePath;
- (NSString * _Nonnull)importFileBlockingWithDestinationPath:(NSString * _Nonnull)destinationPath;
@end

@interface KeepAliveManager : NSObject
+ (instancetype _Nonnull)shared;
+ (BOOL)isEnabled;
- (void)setEnabled:(BOOL)enabled;
@end

static NSString * const kNotifiedErrorCountsKey = @"com.siddarthkay.syncup.notifiedErrorCounts";
static NSString * const kVaultRegistryKey = @"com.siddarthkay.syncup.vaultRegistry";
static NSString * const kNotifiedVaultStaleKey = @"com.siddarthkay.syncup.notifiedVaultStale";

@interface GoBridgeWrapper ()
+ (void)deliverNotificationTitle:(NSString *)title body:(NSString *)body;
+ (void)postFolderErrorsNotificationWithLabel:(NSString *)label
                                         count:(NSInteger)count
                                        sample:(NSString *)sample;
+ (void)acquireExternalRootsAndRegister:(id)api;
@end

@interface GobridgeMobileAPI : NSObject
- (long)startServer:(NSString *)dataDir;
- (void)stopServer;
- (long)getServerPort;
- (NSString *)getAPIKey;
- (NSString *)getDeviceID;
- (NSString *)getGUIAddress;
- (NSString *)getDataDir;
- (NSString *)getFoldersRoot;
- (BOOL)setFoldersRoot:(NSString *)path;
- (NSString *)listSubdirs:(NSString *)path;
- (NSString *)mkdirSubdir:(NSString *)parent name:(NSString *)name;
- (NSString *)removeDir:(NSString *)path;
- (void)setSuspended:(BOOL)suspended;
- (void)registerExternalRoot:(NSString *)path;
- (void)unregisterExternalRoot:(NSString *)path;
- (NSString *)exportConfig:(NSString *)srcDataDir dstZipPath:(NSString *)dstZipPath extrasJSON:(NSString *)extrasJSON;
- (NSString *)importConfig:(NSString *)srcZipPath dstDataDir:(NSString *)dstDataDir password:(NSString *)password;
- (NSString *)getSystemLog:(NSString *)since limit:(long)limit;
- (NSString *)writeSystemLog:(NSString *)dstPath;
@end

static Class GobridgeMobileAPIClass;

@implementation GoBridgeWrapper

+ (void)initialize {
  if (self == [GoBridgeWrapper class]) {
    GobridgeMobileAPIClass = NSClassFromString(@"GobridgeMobileAPI");
  }
}

+ (id)api {
  if (!GobridgeMobileAPIClass) {
    return nil;
  }
  return [[GobridgeMobileAPIClass alloc] init];
}

+ (NSString *)dataDir {
  // Documents/ so Files.app can see it (needs UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace).
  NSArray<NSURL *> *urls = [[NSFileManager defaultManager]
      URLsForDirectory:NSDocumentDirectory
             inDomains:NSUserDomainMask];
  NSURL *base = urls.firstObject;
  if (!base) {
    return NSTemporaryDirectory();
  }
  NSURL *dir = [base URLByAppendingPathComponent:@"syncthing" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:dir
                           withIntermediateDirectories:YES
                                            attributes:nil
                                                 error:nil];
  return dir.path;
}

+ (NSNumber *)startServer {
  @try {
    id api = [self api];
    if (!api) return @(0);
    NSString *dataDir = [self dataDir];
    // Acquire scope on every persisted external folder BEFORE the daemon
    // starts a scan/watch. Idempotent — acquireAll skips already-acquired
    // entries, so BG re-entries are safe.
    [self acquireExternalRootsAndRegister:api];
    return @([api startServer:dataDir]);
  } @catch (NSException *exception) {
    return @(0);
  }
}

+ (NSNumber *)stopServer {
  @try {
    id api = [self api];
    if (!api) return @(NO);
    [api stopServer];
    // Release scope after the daemon has fully drained so any in-flight
    // file ops get to complete first.
    [ScopedFolderStore.shared releaseAll];
    return @(YES);
  } @catch (NSException *exception) {
    return @(NO);
  }
}

+ (void)acquireExternalRootsAndRegister:(id)api {
  NSDictionary<NSString *, NSString *> *roots = [ScopedFolderStore.shared acquireAll];
  if (![api respondsToSelector:@selector(registerExternalRoot:)]) {
    return;
  }
  for (NSString *path in roots.allKeys) {
    if (path.length > 0) {
      [api registerExternalRoot:path];
    }
  }
}

+ (NSNumber *)getServerPort {
  @try {
    id api = [self api];
    if (!api) return @(0);
    return @([api getServerPort]);
  } @catch (NSException *exception) {
    return @(0);
  }
}

+ (NSString *)getApiKey {
  @try {
    id api = [self api];
    if (!api) return @"";
    return [api getAPIKey] ?: @"";
  } @catch (NSException *exception) {
    return @"";
  }
}

+ (NSString *)getDeviceId {
  @try {
    id api = [self api];
    if (!api) return @"";
    return [api getDeviceID] ?: @"";
  } @catch (NSException *exception) {
    return @"";
  }
}

+ (NSString *)getGuiAddress {
  @try {
    id api = [self api];
    if (!api) return @"";
    return [api getGUIAddress] ?: @"";
  } @catch (NSException *exception) {
    return @"";
  }
}

+ (NSString *)getDataDir {
  @try {
    id api = [self api];
    if (!api) return @"";
    return [api getDataDir] ?: @"";
  } @catch (NSException *exception) {
    return @"";
  }
}

+ (NSString *)listSubdirs:(NSString *)path {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api listSubdirs:(path ?: @"")] ?: @"{\"error\":\"nil result\"}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (NSString *)mkdirSubdir:(NSString *)parent name:(NSString *)name {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api mkdirSubdir:(parent ?: @"") name:(name ?: @"")] ?: @"{\"error\":\"nil result\"}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (NSString *)removeDir:(NSString *)path {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api removeDir:(path ?: @"")] ?: @"{\"error\":\"nil result\"}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (NSString *)copyFile:(NSString *)src dst:(NSString *)dst {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api copyFile:(src ?: @"") dst:(dst ?: @"")] ?: @"{\"error\":\"nil result\"}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (NSString *)resolvePath:(NSString *)path {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api resolvePath:(path ?: @"")] ?: @"{\"error\":\"nil result\"}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (NSString *)zipDir:(NSString *)srcDir dstPath:(NSString *)dstPath {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api zipDir:(srcDir ?: @"") dstPath:(dstPath ?: @"")] ?: @"{\"error\":\"nil result\"}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (void)setSuspended:(BOOL)suspended {
  @try {
    id api = [self api];
    if (!api) return;
    [api setSuspended:suspended];
  } @catch (NSException *exception) {
  }
}

// Android-only shims; JS uses Linking.openURL with shareddocuments:// on iOS.
+ (BOOL)getWifiOnlySync { return NO; }
+ (BOOL)setWifiOnlySync:(BOOL)enabled { return NO; }
+ (BOOL)getChargingOnlySync { return NO; }
+ (BOOL)setChargingOnlySync:(BOOL)enabled { return NO; }

+ (BOOL)getContinuousBackgroundSync {
  return [KeepAliveManager isEnabled];
}
+ (BOOL)setContinuousBackgroundSync:(BOOL)enabled {
  [[KeepAliveManager shared] setEnabled:enabled];
  return [KeepAliveManager isEnabled];
}
+ (BOOL)openBatteryOptimizationSettings { return NO; }
+ (BOOL)isIgnoringBatteryOptimizations { return YES; }
+ (BOOL)openFolderInFileManager:(NSString *)path { return NO; }

+ (NSString *)getFoldersRoot {
  @try {
    id api = [self api];
    if (!api) return @"";
    return [api getFoldersRoot] ?: @"";
  } @catch (NSException *exception) {
    return @"";
  }
}

+ (BOOL)setFoldersRoot:(NSString *)path {
  @try {
    id api = [self api];
    if (!api) return NO;
    return [api setFoldersRoot:(path ?: @"")];
  } @catch (NSException *exception) {
    return NO;
  }
}

// Single entry for fg (TurboModule) and bg (BackgroundErrorNotifier); @synchronized so a BG task
// firing mid-foreground can't race the dedup map. Permission prompt is lazy, fires in context.
+ (BOOL)maybeNotifyFolderErrorsWithFolderId:(NSString *)folderId
                                      count:(NSInteger)count
                                      label:(NSString *)label
                                     sample:(NSString *)sample {
  if (folderId.length == 0) return NO;

  @synchronized (self) {
    NSDictionary<NSString *, NSNumber *> *existing =
        [[NSUserDefaults standardUserDefaults] dictionaryForKey:kNotifiedErrorCountsKey]
            ?: @{};
    NSInteger last = [existing[folderId] integerValue];

    // went healthy, clear so next failure fires fresh.
    if (count <= 0) {
      if (last != 0) {
        NSMutableDictionary *next = [existing mutableCopy];
        [next removeObjectForKey:folderId];
        [[NSUserDefaults standardUserDefaults] setObject:next forKey:kNotifiedErrorCountsKey];
      }
      return NO;
    }

    if (count <= last) return NO;

    // record new high-water mark under the lock, post outside it.
    NSMutableDictionary *next = [existing mutableCopy];
    next[folderId] = @(count);
    [[NSUserDefaults standardUserDefaults] setObject:next forKey:kNotifiedErrorCountsKey];
  }

  [self postFolderErrorsNotificationWithLabel:(label ?: folderId) count:count sample:(sample ?: @"")];
  return YES;
}

+ (void)postFolderErrorsNotificationWithLabel:(NSString *)label
                                         count:(NSInteger)count
                                        sample:(NSString *)sample {
  NSString *title = [NSString stringWithFormat:@"Sync errors in \"%@\"", label];
  NSString *body;
  if (count == 1) {
    body = sample.length > 0 ? sample : @"1 file failed to sync.";
  } else {
    NSString *prefix = [NSString stringWithFormat:@"%ld files failed to sync.", (long)count];
    body = sample.length > 0 ? [NSString stringWithFormat:@"%@ %@", prefix, sample] : prefix;
  }

  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings * _Nonnull settings) {
    if (settings.authorizationStatus == UNAuthorizationStatusNotDetermined) {
      UNAuthorizationOptions opts =
          UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
      [center requestAuthorizationWithOptions:opts completionHandler:^(BOOL granted, NSError * _Nullable error) {
        if (granted) {
          [self deliverNotificationTitle:title body:body];
        }
      }];
      return;
    }
    if (settings.authorizationStatus == UNAuthorizationStatusAuthorized ||
        settings.authorizationStatus == UNAuthorizationStatusProvisional) {
      [self deliverNotificationTitle:title body:body];
    }
  }];
}

+ (void)deliverNotificationTitle:(NSString *)title body:(NSString *)body {
  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
  content.title = title ?: @"";
  content.body = body ?: @"";
  content.sound = [UNNotificationSound defaultSound];
  NSString *identifier = [[NSUUID UUID] UUIDString];
  UNNotificationRequest *request =
      [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:nil];
}

// Persisted by JS each time the vault registry changes. Stored as the raw
// JSON string so the next read-side parse produces a fresh dict (avoids
// stale Foundation collection state if NSUserDefaults caches).
+ (void)setVaultRegistryJSON:(NSString *)json {
  [[NSUserDefaults standardUserDefaults] setObject:(json ?: @"") forKey:kVaultRegistryKey];
}

+ (nullable NSDictionary *)vaultRegistry {
  NSString *json = [[NSUserDefaults standardUserDefaults] stringForKey:kVaultRegistryKey];
  if (json.length == 0) return nil;
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [parsed isKindOfClass:[NSDictionary class]] ? (NSDictionary *)parsed : nil;
}

// Same dedup pattern as folder-error notifies. Key the high-water mark on
// the lastSync timestamp itself: a fresh sync writes a newer ms value, so
// the next stale window will compare unequal and re-fire.
+ (BOOL)maybeNotifyVaultStaleWithFolderId:(NSString *)folderId
                                    label:(NSString *)label
                                lastSyncMs:(int64_t)lastSyncMs
                                  ageMins:(NSInteger)ageMins {
  if (folderId.length == 0) return NO;

  @synchronized (self) {
    NSDictionary<NSString *, NSNumber *> *existing =
        [[NSUserDefaults standardUserDefaults] dictionaryForKey:kNotifiedVaultStaleKey]
            ?: @{};
    int64_t lastNotifiedFor = [existing[folderId] longLongValue];
    if (lastNotifiedFor == lastSyncMs) {
      return NO;
    }
    NSMutableDictionary *next = [existing mutableCopy];
    next[folderId] = @(lastSyncMs);
    [[NSUserDefaults standardUserDefaults] setObject:next forKey:kNotifiedVaultStaleKey];
  }

  NSString *title = [NSString stringWithFormat:@"Vault \"%@\" hasn't synced", label.length > 0 ? label : folderId];
  NSString *body;
  if (ageMins < 60) {
    body = [NSString stringWithFormat:@"Last synced %ld min ago. Open SyncUp to catch up.", (long)ageMins];
  } else if (ageMins < 60 * 24) {
    body = [NSString stringWithFormat:@"Last synced %ldh ago. Open SyncUp to catch up.", (long)(ageMins / 60)];
  } else {
    body = [NSString stringWithFormat:@"Last synced %ld days ago. Open SyncUp to catch up.", (long)(ageMins / (60 * 24))];
  }

  // Reuse the permission/delivery pipeline used by folder-error notifies.
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings * _Nonnull settings) {
    if (settings.authorizationStatus == UNAuthorizationStatusNotDetermined) {
      UNAuthorizationOptions opts =
          UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
      [center requestAuthorizationWithOptions:opts completionHandler:^(BOOL granted, NSError * _Nullable error) {
        if (granted) {
          [self deliverNotificationTitle:title body:body];
        }
      }];
      return;
    }
    if (settings.authorizationStatus == UNAuthorizationStatusAuthorized ||
        settings.authorizationStatus == UNAuthorizationStatusProvisional) {
      [self deliverNotificationTitle:title body:body];
    }
  }];
  return YES;
}

+ (NSString *)pickExternalFolder {
  @try {
    NSString *json = [ScopedFolderStore.shared pickFolderBlocking];
    if (json.length == 0) return @"";

    // Register the picked path with the Go side so JS-driven file ops
    // (ListSubdirs / MkdirSubdir / RemoveDir / CopyFile-dst) accept it
    // immediately without waiting for the next startServer cycle.
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    NSError *err = nil;
    id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&err] : nil;
    if (!err && [parsed isKindOfClass:[NSDictionary class]]) {
      NSString *path = ((NSDictionary *)parsed)[@"path"];
      if ([path isKindOfClass:[NSString class]] && path.length > 0) {
        id api = [self api];
        if (api && [api respondsToSelector:@selector(registerExternalRoot:)]) {
          [api registerExternalRoot:path];
        }
      }
    }
    return json;
  } @catch (NSException *exception) {
    NSLog(@"GoBridgeWrapper: pickExternalFolder exception: %@", exception);
    return @"";
  }
}

+ (NSString *)getPersistedExternalFolders {
  @try {
    NSString *json = [ScopedFolderStore.shared getPersistedFoldersJSON];
    return json ?: @"[]";
  } @catch (NSException *exception) {
    return @"[]";
  }
}

+ (BOOL)revokeExternalFolder:(NSString *)path {
  @try {
    if (path.length == 0) return NO;
    BOOL ok = [ScopedFolderStore.shared revokeFolderByPath:path];
    if (ok) {
      id api = [self api];
      if (api && [api respondsToSelector:@selector(unregisterExternalRoot:)]) {
        [api unregisterExternalRoot:path];
      }
    }
    return ok;
  } @catch (NSException *exception) {
    return NO;
  }
}

+ (BOOL)validateExternalFolder:(NSString *)path {
  @try {
    if (path.length == 0) return NO;
    return [ScopedFolderStore.shared validateFolderByPath:path];
  } @catch (NSException *exception) {
    return NO;
  }
}

+ (NSString *)getExternalFolderDisplayName:(NSString *)path {
  @try {
    if (path.length == 0) return @"";
    return [ScopedFolderStore.shared getDisplayNameByPath:path] ?: @"";
  } @catch (NSException *exception) {
    return @"";
  }
}

+ (void)previewFile:(NSString *)pathsJson startIndex:(NSInteger)startIndex {
  @try {
    if (pathsJson.length == 0) return;
    NSData *data = [pathsJson dataUsingEncoding:NSUTF8StringEncoding];
    NSError *err = nil;
    id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
    if (err || ![parsed isKindOfClass:[NSArray class]]) {
      NSLog(@"GoBridgeWrapper: previewFile bad json: %@", err);
      return;
    }
    NSMutableArray<NSString *> *paths = [NSMutableArray array];
    for (id item in (NSArray *)parsed) {
      if ([item isKindOfClass:[NSString class]] && [(NSString *)item length] > 0) {
        [paths addObject:(NSString *)item];
      }
    }
    if (paths.count == 0) return;
    [QuickLookPresenter.shared presentWithPaths:paths startIndex:startIndex];
  } @catch (NSException *exception) {
    NSLog(@"GoBridgeWrapper: previewFile exception: %@", exception);
  }
}

+ (NSString *)errorJSON:(NSString *)message {
  NSDictionary *obj = @{ @"ok": @NO, @"error": message ?: @"unknown error" };
  NSError *err = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:obj options:0 error:&err];
  if (!data) return @"{\"ok\":false,\"error\":\"json error\"}";
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
}

+ (NSString *)exportConfig:(NSString *)asyncStorageJson {
  @try {
    id api = [self api];
    if (!api) return [self errorJSON:@"bridge not initialized"];

    NSString *cacheDir = NSTemporaryDirectory();
    NSString *stem = [NSString stringWithFormat:@"syncup-backup-%@.zip",
                      [self timestampString]];
    NSString *stagedPath = [cacheDir stringByAppendingPathComponent:stem];
    NSString *asyncPath = [cacheDir stringByAppendingPathComponent:@"syncup-async.json"];
    [[NSFileManager defaultManager] removeItemAtPath:stagedPath error:nil];
    [[NSFileManager defaultManager] removeItemAtPath:asyncPath error:nil];

    NSMutableArray *extras = [NSMutableArray array];
    if (asyncStorageJson.length > 0 && ![asyncStorageJson isEqualToString:@"{}"]) {
      NSError *writeErr = nil;
      [asyncStorageJson writeToFile:asyncPath
                         atomically:YES
                           encoding:NSUTF8StringEncoding
                              error:&writeErr];
      if (writeErr) {
        return [self errorJSON:[NSString stringWithFormat:@"async write failed: %@", writeErr.localizedDescription]];
      }
      [extras addObject:@{ @"name": @"syncup-async.json", @"path": asyncPath }];
    }
    NSData *extrasData = [NSJSONSerialization dataWithJSONObject:extras options:0 error:nil];
    NSString *extrasJSON = [[NSString alloc] initWithData:extrasData encoding:NSUTF8StringEncoding] ?: @"[]";

    NSString *result = [api exportConfig:@"" dstZipPath:stagedPath extrasJSON:extrasJSON];
    [[NSFileManager defaultManager] removeItemAtPath:asyncPath error:nil];
    if (result.length == 0) return [self errorJSON:@"nil result"];
    NSData *data = [result dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if ([parsed isKindOfClass:[NSDictionary class]]) {
      NSString *errStr = ((NSDictionary *)parsed)[@"error"];
      if (errStr.length > 0) {
        [[NSFileManager defaultManager] removeItemAtPath:stagedPath error:nil];
        return [self errorJSON:errStr];
      }
    }

    NSString *destPath = [BackupPicker.shared exportFileBlockingWithSourcePath:stagedPath];
    [[NSFileManager defaultManager] removeItemAtPath:stagedPath error:nil];
    if (destPath.length == 0) return @"";

    NSDictionary *ok = @{
      @"ok": @YES,
      @"path": destPath,
      @"displayName": [destPath lastPathComponent] ?: stem,
    };
    NSData *okData = [NSJSONSerialization dataWithJSONObject:ok options:0 error:nil];
    return [[NSString alloc] initWithData:okData encoding:NSUTF8StringEncoding] ?: @"";
  } @catch (NSException *exception) {
    NSLog(@"GoBridgeWrapper: exportConfig exception: %@", exception);
    return [self errorJSON:exception.reason ?: @"exception"];
  }
}

+ (NSString *)importConfig:(NSString *)password {
  @try {
    id api = [self api];
    if (!api) return [self errorJSON:@"bridge not initialized"];

    NSString *cacheDir = NSTemporaryDirectory();
    NSString *stagedPath = [cacheDir stringByAppendingPathComponent:@"syncup-restore.zip"];
    NSString *picked = [BackupPicker.shared importFileBlockingWithDestinationPath:stagedPath];
    if (picked.length == 0) return @"";

    NSString *dataDir = [self dataDir] ?: @"";
    NSString *result = [api importConfig:stagedPath dstDataDir:dataDir password:(password ?: @"")];
    [[NSFileManager defaultManager] removeItemAtPath:stagedPath error:nil];
    if (result.length == 0) return [self errorJSON:@"nil result"];

    NSData *data = [result dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSString *errStr = nil;
    BOOL importedAsync = NO;
    if ([parsed isKindOfClass:[NSDictionary class]]) {
      errStr = ((NSDictionary *)parsed)[@"error"];
      importedAsync = [((NSDictionary *)parsed)[@"importedAsync"] boolValue];
    }
    if (errStr.length > 0) return [self errorJSON:errStr];

    NSString *asyncJson = @"";
    if (importedAsync) {
      NSString *asyncFile = [dataDir stringByAppendingPathComponent:@"syncup-async.json"];
      NSError *readErr = nil;
      NSString *contents = [NSString stringWithContentsOfFile:asyncFile
                                                     encoding:NSUTF8StringEncoding
                                                        error:&readErr];
      if (contents) asyncJson = contents;
      [[NSFileManager defaultManager] removeItemAtPath:asyncFile error:nil];
    }

    NSDictionary *ok = @{
      @"ok": @YES,
      @"path": dataDir,
      @"displayName": [picked lastPathComponent] ?: @"",
      @"importedPrefs": @NO,
      @"asyncStorageJson": asyncJson,
    };
    NSData *okData = [NSJSONSerialization dataWithJSONObject:ok options:0 error:nil];
    return [[NSString alloc] initWithData:okData encoding:NSUTF8StringEncoding] ?: @"";
  } @catch (NSException *exception) {
    NSLog(@"GoBridgeWrapper: importConfig exception: %@", exception);
    return [self errorJSON:exception.reason ?: @"exception"];
  }
}

+ (NSString *)getSystemLog:(NSString *)since limit:(NSInteger)limit {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api getSystemLog:(since ?: @"") limit:(long)limit] ?: @"{\"messages\":[]}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (NSString *)writeSystemLog:(NSString *)dstPath {
  @try {
    id api = [self api];
    if (!api) return @"{\"error\":\"bridge not initialized\"}";
    return [api writeSystemLog:(dstPath ?: @"")] ?: @"{\"error\":\"nil result\"}";
  } @catch (NSException *exception) {
    return @"{\"error\":\"exception\"}";
  }
}

+ (NSString *)timestampString {
  NSDateFormatter *df = [[NSDateFormatter alloc] init];
  df.dateFormat = @"yyyyMMdd-HHmmss";
  df.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  return [df stringFromDate:[NSDate date]];
}

@end
