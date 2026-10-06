import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import GoBridge from '../GoServerBridgeJSI';
import { SyncthingClient } from '../api/syncthing';
import { reconcileExternalFolderPaths } from '../fs/externalFolder';

export interface DaemonInfo {
  port: number;
  apiKey: string;
  deviceId: string;
  guiAddress: string;
  dataDir: string;
  /** Where new folders get created and the picker is rooted. May change at runtime. */
  foldersRoot: string;
}

interface SyncthingContextValue {
  info: DaemonInfo | null;
  client: SyncthingClient | null;
  error: string | null;
  restart: () => void;
  /** Halt the daemon. Leaves it stopped until restart() or start(). */
  stop: () => void;
  /** Start the daemon if it's currently stopped. No-op if already running. */
  start: () => void;
  /** Re-read storage state after a permission grant/revoke. */
  refreshStorageState: () => void;
}

const Ctx = createContext<SyncthingContextValue | null>(null);

async function pingDaemon(
  guiAddress: string,
  apiKey: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!guiAddress || !apiKey) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${guiAddress}/rest/system/ping`, {
      headers: { 'X-API-Key': apiKey },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sameInfo(prev: DaemonInfo | null, next: DaemonInfo): boolean {
  if (!prev) return false;
  return (
    prev.port === next.port &&
    prev.apiKey === next.apiKey &&
    prev.guiAddress === next.guiAddress &&
    prev.dataDir === next.dataDir &&
    prev.foldersRoot === next.foldersRoot
  );
}

async function relocateDriftedFolders(info: DaemonInfo): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const client = new SyncthingClient({ apiKey: info.apiKey, guiAddress: info.guiAddress });
    await reconcileExternalFolderPaths(client, info.foldersRoot);
  } catch (e) {
    console.warn('external folder relocation failed:', e);
  }
}

function readNativeInfo(): DaemonInfo | null {
  const port = GoBridge.startServer();
  if (port <= 0) return null;
  return {
    port,
    apiKey: GoBridge.getApiKey(),
    deviceId: GoBridge.getDeviceId(),
    guiAddress: GoBridge.getGuiAddress(),
    dataDir: GoBridge.getDataDir(),
    foldersRoot: GoBridge.getFoldersRoot(),
  };
}

export function SyncthingProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<DaemonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const verifyingRef = useRef(false);

  const start = useCallback(() => {
    try {
      const next = readNativeInfo();
      if (!next) {
        setError('startServer returned 0 - see native logs');
        return;
      }
      setInfo(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const verifyAndRecover = useCallback(async () => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    try {
      const first = readNativeInfo();
      if (!first) {
        setError('startServer returned 0 - see native logs');
        return;
      }
      setInfo(prev => (sameInfo(prev, first) ? prev : first));
      setError(null);

      const alive = await pingDaemon(first.guiAddress, first.apiKey, 2000);
      if (alive) {
        await relocateDriftedFolders(first);
        return;
      }

      try {
        GoBridge.stopServer();
      } catch {
        // ignore — recovery still proceeds
      }
      const recovered = readNativeInfo();
      if (!recovered) {
        setError('startServer returned 0 - see native logs');
        return;
      }
      setInfo(prev => (sameInfo(prev, recovered) ? prev : recovered));
      // Existing event long-poll / useResource retries pick up the fresh
      // listener on their next tick; no need to re-ping here.
      if (await pingDaemon(recovered.guiAddress, recovered.apiKey, 5000)) {
        await relocateDriftedFolders(recovered);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      verifyingRef.current = false;
    }
  }, []);

  // refresh storage fields without a daemon restart; picker re-anchors next open
  const refreshStorageState = useCallback(() => {
    setInfo(prev => {
      if (!prev) return prev;
      try {
        return {
          ...prev,
          foldersRoot: GoBridge.getFoldersRoot(),
        };
      } catch {
        return prev;
      }
    });
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void verifyAndRecover();
    // Mirror the AsyncStorage-backed vault registry to native UserDefaults
    // once on launch. Fixes the case where the app updates and native is
    // ahead/behind the JS-side persisted state.
    void import('../utils/vaultRegistry').then(m => m.pushRegistryToNative());
  }, [verifyAndRecover]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') return;
      void verifyAndRecover();
    });
    return () => sub.remove();
  }, [verifyAndRecover]);

  const client = useMemo(() => {
    if (!info || !info.apiKey || !info.guiAddress) return null;
    return new SyncthingClient({ apiKey: info.apiKey, guiAddress: info.guiAddress });
  }, [info]);

  const stop = useCallback(() => {
    try {
      GoBridge.stopServer();
    } catch {
      // ignore
    }
    setInfo(null);
    setError(null);
    startedRef.current = false;
  }, []);

  const restart = useCallback(() => {
    try {
      GoBridge.stopServer();
    } catch {
      // ignore
    }
    setInfo(null);
    startedRef.current = false;
    start();
  }, [start]);

  const value = useMemo<SyncthingContextValue>(
    () => ({ info, client, error, restart, stop, start, refreshStorageState }),
    [info, client, error, restart, stop, start, refreshStorageState],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSyncthing(): SyncthingContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error('useSyncthing must be used inside <SyncthingProvider>');
  }
  return v;
}

export function useSyncthingClient(): SyncthingClient {
  const { client } = useSyncthing();
  if (!client) {
    throw new Error('Daemon not ready - check useSyncthing().info first');
  }
  return client;
}
