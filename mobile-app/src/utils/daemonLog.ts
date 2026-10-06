import type { SystemLogMessage } from '../api/types';

// Decoders for the native log bridge (GoBridge.getSystemLog / writeSystemLog).

export interface LogFileResult {
  path: string;
  bytes: number;
  version: string;
  os: string;
  arch: string;
  deviceId: string;
  uptimeSec: number;
  goroutines: number;
}

export function parseSystemLog(json: string): SystemLogMessage[] {
  const parsed = JSON.parse(json) as {
    messages?: SystemLogMessage[] | null;
    error?: string;
  };
  if (parsed.error) throw new Error(parsed.error);
  return parsed.messages ?? [];
}

export function parseLogFileResult(json: string): LogFileResult {
  const parsed = JSON.parse(json) as Partial<LogFileResult> & { error?: string };
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.path) throw new Error('log export returned no path');
  return {
    path: parsed.path,
    bytes: parsed.bytes ?? 0,
    version: parsed.version ?? '',
    os: parsed.os ?? '',
    arch: parsed.arch ?? '',
    deviceId: parsed.deviceId ?? '',
    uptimeSec: parsed.uptimeSec ?? 0,
    goroutines: parsed.goroutines ?? 0,
  };
}
