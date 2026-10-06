import NativeGoServerBridge from './NativeGoServerBridge';

export interface GoServerBridgeInterface {
  startServer(): number;
  stopServer(): boolean;
  getServerPort(): number;
  getApiKey(): string;
  getDeviceId(): string;
  getGuiAddress(): string;
  getDataDir(): string;
  listSubdirs(path: string): string;
  mkdirSubdir(parent: string, name: string): string;
  removeDir(path: string): string;
  copyFile(src: string, dst: string): string;
  resolvePath(path: string): string;
  zipDir(srcDir: string, dstPath: string): string;
  setSuspended(suspended: boolean): void;
  getWifiOnlySync(): boolean;
  setWifiOnlySync(enabled: boolean): boolean;
  getChargingOnlySync(): boolean;
  setChargingOnlySync(enabled: boolean): boolean;
  getContinuousBackgroundSync(): boolean;
  setContinuousBackgroundSync(enabled: boolean): boolean;
  getAllowMeteredWifi(): boolean;
  setAllowMeteredWifi(enabled: boolean): boolean;
  getAllowMobileData(): boolean;
  setAllowMobileData(enabled: boolean): boolean;
  openBatteryOptimizationSettings(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  openFolderInFileManager(path: string): boolean;
  getFoldersRoot(): string;
  setFoldersRoot(path: string): boolean;
  maybeNotifyFolderErrors(
    folderId: string,
    count: number,
    label: string,
    sampleError: string,
  ): boolean;
  setVaultRegistry(json: string): void;
  getExternalControlEnabled(): boolean;
  setExternalControlEnabled(enabled: boolean): boolean;
  getStartOnBoot(): boolean;
  setStartOnBoot(enabled: boolean): boolean;
  pickExternalFolder(): string;
  getPersistedExternalFolders(): string;
  revokeExternalFolder(path: string): boolean;
  getExternalFolderDisplayName(path: string): string;
  validateExternalFolder(path: string): boolean;
  copySafFileToCache(treeURI: string, relativePath: string): string;
  previewFileNative(pathsJson: string, startIndex: number): void;
  hasAllFilesAccess(): boolean;
  requestAllFilesAccess(): boolean;
  listLocalSubdirs(path: string): string;
  mkdirLocalSubdir(parent: string, name: string): string;
  getExternalStorageRoot(): string;
  exportConfig(asyncStorageJson: string): string;
  importConfig(password: string): string;
  getSystemLog(since: string, limit: number): string;
  writeSystemLog(dstPath: string): string;
}

class GoServerBridgeJSI implements GoServerBridgeInterface {
  startServer(): number {
    return NativeGoServerBridge.startServer();
  }

  stopServer(): boolean {
    return NativeGoServerBridge.stopServer();
  }

  getServerPort(): number {
    return NativeGoServerBridge.getServerPort();
  }

  getApiKey(): string {
    return NativeGoServerBridge.getApiKey();
  }

  getDeviceId(): string {
    return NativeGoServerBridge.getDeviceId();
  }

  getGuiAddress(): string {
    return NativeGoServerBridge.getGuiAddress();
  }

  getDataDir(): string {
    return NativeGoServerBridge.getDataDir();
  }

  listSubdirs(path: string): string {
    return NativeGoServerBridge.listSubdirs(path);
  }

  mkdirSubdir(parent: string, name: string): string {
    return NativeGoServerBridge.mkdirSubdir(parent, name);
  }

  removeDir(path: string): string {
    return NativeGoServerBridge.removeDir(path);
  }

  copyFile(src: string, dst: string): string {
    return NativeGoServerBridge.copyFile(src, dst);
  }

  resolvePath(path: string): string {
    return NativeGoServerBridge.resolvePath(path);
  }

  zipDir(srcDir: string, dstPath: string): string {
    return NativeGoServerBridge.zipDir(srcDir, dstPath);
  }

  setSuspended(suspended: boolean): void {
    NativeGoServerBridge.setSuspended(suspended);
  }

  getWifiOnlySync(): boolean {
    return NativeGoServerBridge.getWifiOnlySync();
  }

  setWifiOnlySync(enabled: boolean): boolean {
    return NativeGoServerBridge.setWifiOnlySync(enabled);
  }

  getChargingOnlySync(): boolean {
    return NativeGoServerBridge.getChargingOnlySync();
  }

  setChargingOnlySync(enabled: boolean): boolean {
    return NativeGoServerBridge.setChargingOnlySync(enabled);
  }

  getContinuousBackgroundSync(): boolean {
    return NativeGoServerBridge.getContinuousBackgroundSync();
  }

  setContinuousBackgroundSync(enabled: boolean): boolean {
    return NativeGoServerBridge.setContinuousBackgroundSync(enabled);
  }

  getAllowMeteredWifi(): boolean {
    return NativeGoServerBridge.getAllowMeteredWifi();
  }

  setAllowMeteredWifi(enabled: boolean): boolean {
    return NativeGoServerBridge.setAllowMeteredWifi(enabled);
  }

  getAllowMobileData(): boolean {
    return NativeGoServerBridge.getAllowMobileData();
  }

  setAllowMobileData(enabled: boolean): boolean {
    return NativeGoServerBridge.setAllowMobileData(enabled);
  }

  openBatteryOptimizationSettings(): boolean {
    return NativeGoServerBridge.openBatteryOptimizationSettings();
  }

  isIgnoringBatteryOptimizations(): boolean {
    return NativeGoServerBridge.isIgnoringBatteryOptimizations();
  }

  openFolderInFileManager(path: string): boolean {
    return NativeGoServerBridge.openFolderInFileManager(path);
  }

  getFoldersRoot(): string {
    return NativeGoServerBridge.getFoldersRoot();
  }

  setFoldersRoot(path: string): boolean {
    return NativeGoServerBridge.setFoldersRoot(path);
  }

  maybeNotifyFolderErrors(
    folderId: string,
    count: number,
    label: string,
    sampleError: string,
  ): boolean {
    return NativeGoServerBridge.maybeNotifyFolderErrors(
      folderId,
      count,
      label,
      sampleError,
    );
  }

  setVaultRegistry(json: string): void {
    NativeGoServerBridge.setVaultRegistry(json);
  }

  getExternalControlEnabled(): boolean {
    return NativeGoServerBridge.getExternalControlEnabled();
  }

  setExternalControlEnabled(enabled: boolean): boolean {
    return NativeGoServerBridge.setExternalControlEnabled(enabled);
  }

  getStartOnBoot(): boolean {
    return NativeGoServerBridge.getStartOnBoot();
  }

  setStartOnBoot(enabled: boolean): boolean {
    return NativeGoServerBridge.setStartOnBoot(enabled);
  }

  pickExternalFolder(): string {
    return NativeGoServerBridge.pickExternalFolder();
  }

  getPersistedExternalFolders(): string {
    return NativeGoServerBridge.getPersistedExternalFolders();
  }

  revokeExternalFolder(path: string): boolean {
    return NativeGoServerBridge.revokeExternalFolder(path);
  }

  getExternalFolderDisplayName(path: string): string {
    return NativeGoServerBridge.getExternalFolderDisplayName(path);
  }

  validateExternalFolder(path: string): boolean {
    return NativeGoServerBridge.validateExternalFolder(path);
  }

  copySafFileToCache(treeURI: string, relativePath: string): string {
    return NativeGoServerBridge.copySafFileToCache(treeURI, relativePath);
  }

  previewFileNative(pathsJson: string, startIndex: number): void {
    NativeGoServerBridge.previewFileNative(pathsJson, startIndex);
  }

  hasAllFilesAccess(): boolean {
    return NativeGoServerBridge.hasAllFilesAccess();
  }

  requestAllFilesAccess(): boolean {
    return NativeGoServerBridge.requestAllFilesAccess();
  }

  listLocalSubdirs(path: string): string {
    return NativeGoServerBridge.listLocalSubdirs(path);
  }

  mkdirLocalSubdir(parent: string, name: string): string {
    return NativeGoServerBridge.mkdirLocalSubdir(parent, name);
  }

  getExternalStorageRoot(): string {
    return NativeGoServerBridge.getExternalStorageRoot();
  }

  exportConfig(asyncStorageJson: string): string {
    return NativeGoServerBridge.exportConfig(asyncStorageJson);
  }

  importConfig(password: string): string {
    return NativeGoServerBridge.importConfig(password);
  }

  getSystemLog(since: string, limit: number): string {
    return NativeGoServerBridge.getSystemLog(since, limit);
  }

  writeSystemLog(dstPath: string): string {
    return NativeGoServerBridge.writeSystemLog(dstPath);
  }
}

export default new GoServerBridgeJSI();
