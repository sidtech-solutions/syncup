import type {
  Config,
  Connections,
  DbStatus,
  DeviceConfig,
  FolderConfig,
  FolderError,
  FolderErrorsResponse,
  IgnoresResponse,
  Options,
  SystemStatus,
  SystemVersion,
  Completion,
  PendingFolders,
  PendingDevices,
  PendingFolderOffer,
  PendingDeviceOffer,
  TreeEntry,
  NeedFile,
} from './types';

const DEFAULT_TIMEOUT_MS = 8000;

export class SyncthingApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'SyncthingApiError';
  }
}

// Detects the AbortController-driven timeout we wrap fetch with. The
// underlying DOMException's name is 'AbortError' and message is 'Aborted',
// which gets re-wrapped as a SyncthingApiError with the message preserved.
export function isAbortError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.message === 'Aborted' || e.name === 'AbortError';
}

export interface SyncthingClientOptions {
  guiAddress: string;
  apiKey: string;
  timeoutMs?: number;
}

export class SyncthingClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor({ guiAddress, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }: SyncthingClientOptions) {
    this.baseUrl = `http://${guiAddress}`;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new SyncthingApiError(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
          url,
        );
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      return (await res.text()) as unknown as T;
    } catch (e) {
      if (e instanceof SyncthingApiError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new SyncthingApiError(msg, undefined, url);
    } finally {
      clearTimeout(timer);
    }
  }

  systemStatus() {
    return this.request<SystemStatus>('/rest/system/status');
  }

  systemVersion() {
    return this.request<SystemVersion>('/rest/system/version');
  }

  systemPing() {
    return this.request<{ ping: string }>('/rest/system/ping');
  }

  systemRestart() {
    return this.request<void>('/rest/system/restart', { method: 'POST' });
  }

  config() {
    return this.request<Config>('/rest/config');
  }

  folders() {
    return this.request<Config['folders']>('/rest/config/folders');
  }

  devices() {
    return this.request<Config['devices']>('/rest/config/devices');
  }

  options() {
    return this.request<Options>('/rest/config/options');
  }

  patchOptions(patch: Partial<Options>) {
    return this.request<void>('/rest/config/options', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  putDevice(device: DeviceConfig) {
    return this.request<void>(`/rest/config/devices/${encodeURIComponent(device.deviceID)}`, {
      method: 'PUT',
      body: JSON.stringify(device),
    });
  }

  patchDevice(deviceId: string, patch: Partial<DeviceConfig>) {
    return this.request<void>(`/rest/config/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  deleteDevice(deviceId: string) {
    return this.request<void>(`/rest/config/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    });
  }

  putFolder(folder: FolderConfig) {
    // syncthing holds the HTTP response open until the new folder finishes
    // its synchronous startup (load ignores, CheckPath/CreateMarker, build
    // runner). On Android with SAF for a large existing folder this can
    // take 10-30s on first add — well past the default 8s timeout. Use a
    // generous timeout so the request doesn't abort mid-setup, which would
    // surface as a misleading "Aborted" error in the UI even though the
    // folder was actually created.
    return this.request<void>(`/rest/config/folders/${encodeURIComponent(folder.id)}`, {
      method: 'PUT',
      body: JSON.stringify(folder),
      timeoutMs: 120_000,
    });
  }

  // Polls the folders list until folderId appears, or the deadline elapses.
  // Use after a putFolder that aborted client-side: the server may still be
  // working through synchronous startup, so before declaring failure we
  // verify whether the folder actually got registered.
  async waitForFolder(
    folderId: string,
    opts: { deadlineMs?: number; intervalMs?: number } = {},
  ): Promise<boolean> {
    const deadline = Date.now() + (opts.deadlineMs ?? 60_000);
    const interval = opts.intervalMs ?? 1_500;
    while (Date.now() < deadline) {
      try {
        const folders = await this.folders();
        if (folders.some(f => f.id === folderId)) return true;
      } catch {
        // Transient fetch failure — keep polling until the deadline.
      }
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  patchFolder(folderId: string, patch: Partial<FolderConfig>) {
    return this.request<void>(`/rest/config/folders/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  deleteFolder(folderId: string) {
    return this.request<void>(`/rest/config/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE',
    });
  }

  dbStatus(folderId: string) {
    return this.request<DbStatus>(`/rest/db/status?folder=${encodeURIComponent(folderId)}`);
  }

  // levels=0 returns just the immediate children of `prefix` (handy for a
  // file-browser pagination model). Omit/use -1 for a full recursive tree.
  async dbBrowse(folderId: string, prefix = '', levels = 0): Promise<TreeEntry[]> {
    const params = new URLSearchParams({ folder: folderId });
    if (prefix) params.set('prefix', prefix);
    params.set('levels', String(levels));
    const res = await this.request<TreeEntry[] | null>(
      `/rest/db/browse?${params.toString()}`,
    );
    return res ?? [];
  }

  async folderErrors(folderId: string): Promise<FolderError[]> {
    const res = await this.request<FolderErrorsResponse>(
      `/rest/folder/errors?folder=${encodeURIComponent(folderId)}`,
    );
    return res.errors ?? [];
  }

  async getIgnores(folderId: string): Promise<string[]> {
    const res = await this.request<IgnoresResponse>(
      `/rest/db/ignores?folder=${encodeURIComponent(folderId)}`,
    );
    return res.ignore ?? [];
  }

  async setIgnores(folderId: string, lines: string[]): Promise<void> {
    await this.request<void>(
      `/rest/db/ignores?folder=${encodeURIComponent(folderId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ ignore: lines }),
      },
    );
  }

  // `sub` scopes to a subpath; omit to rescan the whole folder
  scanFolder(folderId: string, sub?: string) {
    const params = new URLSearchParams({ folder: folderId });
    if (sub) params.set('sub', sub);
    return this.request<void>(`/rest/db/scan?${params.toString()}`, {
      method: 'POST',
    });
  }

  // sendonly folders only; publishes local state as authoritative
  overrideFolder(folderId: string) {
    return this.request<void>(
      `/rest/db/override?folder=${encodeURIComponent(folderId)}`,
      { method: 'POST' },
    );
  }

  // receiveonly folders only; drops local changes to match the cluster
  revertFolder(folderId: string) {
    return this.request<void>(
      `/rest/db/revert?folder=${encodeURIComponent(folderId)}`,
      { method: 'POST' },
    );
  }

  dbCompletion(deviceId?: string, folderId?: string) {
    const params = new URLSearchParams();
    if (deviceId) params.set('device', deviceId);
    if (folderId) params.set('folder', folderId);
    const qs = params.toString();
    return this.request<Completion>(`/rest/db/completion${qs ? `?${qs}` : ''}`);
  }

  connections() {
    return this.request<Connections>('/rest/system/connections');
  }

  async dbNeed(folderId: string, page = 1, perpage = 100) {
    return this.request<{
      progress: NeedFile[];
      queued: NeedFile[];
      rest: NeedFile[];
      page: number;
      perpage: number;
    }>(`/rest/db/need?folder=${encodeURIComponent(folderId)}&page=${page}&perpage=${perpage}`);
  }

  async dbRemoteNeed(folderId: string, deviceId: string, page = 1, perpage = 100) {
    return this.request<{
      files: NeedFile[];
      page: number;
      perpage: number;
    }>(
      `/rest/db/remoteneed?folder=${encodeURIComponent(folderId)}&device=${encodeURIComponent(deviceId)}&page=${page}&perpage=${perpage}`,
    );
  }

  systemDiscovery() {
    return this.request<Record<string, { addresses: string[] }>>('/rest/system/discovery');
  }

  // offers from peers we haven't accepted yet; flattened one row per pair
  async pendingFolders(): Promise<PendingFolderOffer[]> {
    const raw = await this.request<PendingFolders>('/rest/cluster/pending/folders');
    const out: PendingFolderOffer[] = [];
    for (const [folderId, entry] of Object.entries(raw ?? {})) {
      for (const [deviceId, detail] of Object.entries(entry?.offeredBy ?? {})) {
        out.push({
          folderId,
          deviceId,
          label: detail.label,
          time: detail.time,
          receiveEncrypted: detail.receiveEncrypted,
          remoteEncrypted: detail.remoteEncrypted,
        });
      }
    }
    return out;
  }

  async pendingDevices(): Promise<PendingDeviceOffer[]> {
    const raw = await this.request<PendingDevices>('/rest/cluster/pending/devices');
    const out: PendingDeviceOffer[] = [];
    for (const [deviceId, entry] of Object.entries(raw ?? {})) {
      out.push({
        deviceId,
        name: entry?.name ?? '',
        address: entry?.address ?? '',
        time: entry?.time ?? '',
      });
    }
    return out;
  }

  dismissPendingFolder(folderId: string, deviceId?: string) {
    const params = new URLSearchParams({ folder: folderId });
    if (deviceId) params.set('device', deviceId);
    return this.request<void>(`/rest/cluster/pending/folders?${params.toString()}`, {
      method: 'DELETE',
    });
  }

  dismissPendingDevice(deviceId: string) {
    const params = new URLSearchParams({ device: deviceId });
    return this.request<void>(`/rest/cluster/pending/devices?${params.toString()}`, {
      method: 'DELETE',
    });
  }
}

export type { SystemStatus, SystemVersion, Config, Connections, DbStatus } from './types';
