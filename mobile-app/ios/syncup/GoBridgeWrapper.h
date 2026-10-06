#import <Foundation/Foundation.h>

@interface GoBridgeWrapper : NSObject

+ (NSNumber *)startServer;
+ (NSNumber *)stopServer;
+ (NSNumber *)getServerPort;
+ (NSString *)getApiKey;
+ (NSString *)getDeviceId;
+ (NSString *)getGuiAddress;
+ (NSString *)getDataDir;
+ (NSString *)listSubdirs:(NSString *)path;
+ (NSString *)mkdirSubdir:(NSString *)parent name:(NSString *)name;
+ (NSString *)removeDir:(NSString *)path;
+ (NSString *)copyFile:(NSString *)src dst:(NSString *)dst;
+ (NSString *)resolvePath:(NSString *)path;
+ (NSString *)zipDir:(NSString *)srcDir dstPath:(NSString *)dstPath;
+ (void)setSuspended:(BOOL)suspended;
+ (BOOL)getWifiOnlySync;
+ (BOOL)setWifiOnlySync:(BOOL)enabled;
+ (BOOL)getChargingOnlySync;
+ (BOOL)setChargingOnlySync:(BOOL)enabled;
+ (BOOL)getContinuousBackgroundSync;
+ (BOOL)setContinuousBackgroundSync:(BOOL)enabled;
+ (BOOL)openBatteryOptimizationSettings;
+ (BOOL)isIgnoringBatteryOptimizations;
+ (BOOL)openFolderInFileManager:(NSString *)path;
+ (NSString *)getFoldersRoot;
+ (BOOL)setFoldersRoot:(NSString *)path;

/// Deduped folder error notify. Posts only when count > last-notified; count==0 clears the entry.
/// Compare-and-store is @synchronized, both JS and BG threads land here.
+ (BOOL)maybeNotifyFolderErrorsWithFolderId:(NSString *)folderId
                                      count:(NSInteger)count
                                      label:(NSString *)label
                                     sample:(NSString *)sample;

/// Persist the JS-side vault registry so the BG task can detect stale vaults
/// without going through AsyncStorage. JSON shape:
///   { "vaults": ["<folderId>", ...], "lastSyncs": { "<folderId>": <epochMs>, ... } }
+ (void)setVaultRegistryJSON:(NSString *)json;

/// Returns @{ @"vaults": NSArray<NSString*>, @"lastSyncs": NSDictionary<NSString*,NSNumber*> }
/// or nil if nothing has been persisted yet.
+ (nullable NSDictionary *)vaultRegistry;

/// Deduped vault-stale notify. Posts only once per (folderId, lastSyncMs)
/// pair: a fresh sync resets the dedup state, then we re-fire if it goes
/// stale again. Compare-and-store is @synchronized.
+ (BOOL)maybeNotifyVaultStaleWithFolderId:(NSString *)folderId
                                    label:(NSString *)label
                                lastSyncMs:(int64_t)lastSyncMs
                                  ageMins:(NSInteger)ageMins;

/// Block-the-JS-thread folder picker. Returns JSON describing the picked
/// folder, or empty string on cancel. iOS-only; Android renames pickSafFolder
/// to this and keeps its existing return shape (now JSON).
+ (NSString *)pickExternalFolder;

/// JSON array of currently-persisted external folders.
+ (NSString *)getPersistedExternalFolders;

/// Drop scope + persistence for the folder previously identified by path.
+ (BOOL)revokeExternalFolder:(NSString *)path;

/// Returns true if the bookmark for path resolves cleanly (and isn't stale).
+ (BOOL)validateExternalFolder:(NSString *)path;

/// User-facing name (e.g. "Downloads") for the folder previously identified by path.
+ (NSString *)getExternalFolderDisplayName:(NSString *)path;

/// Present QLPreviewController for one or more local file paths.
/// pathsJson is a JSON array of absolute paths. Asynchronous; returns immediately.
+ (void)previewFile:(NSString *)pathsJson startIndex:(NSInteger)startIndex;

+ (NSString * _Nonnull)exportConfig:(NSString * _Nonnull)asyncStorageJson;

+ (NSString * _Nonnull)importConfig:(NSString * _Nonnull)password;

+ (NSString * _Nonnull)getSystemLog:(NSString * _Nonnull)since limit:(NSInteger)limit;

+ (NSString * _Nonnull)writeSystemLog:(NSString * _Nonnull)dstPath;

@end
