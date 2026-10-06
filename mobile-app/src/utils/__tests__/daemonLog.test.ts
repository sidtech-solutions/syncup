import { parseLogFileResult, parseSystemLog } from '../daemonLog';
import { formatLogHeader } from '../logExport';

describe('parseSystemLog', () => {
  it('returns the messages array', () => {
    const lines = parseSystemLog(
      '{"messages":[{"when":"2026-10-04T16:09:10Z","message":"Exiting","level":"INF"}]}',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toBe('Exiting');
    expect(lines[0].level).toBe('INF');
  });

  it('treats a missing or null messages field as empty', () => {
    expect(parseSystemLog('{}')).toEqual([]);
    expect(parseSystemLog('{"messages":null}')).toEqual([]);
    expect(parseSystemLog('{"messages":[]}')).toEqual([]);
  });

  it('throws on a native error payload', () => {
    expect(() => parseSystemLog('{"error":"bridge not initialized"}')).toThrow(
      'bridge not initialized',
    );
  });
});

describe('parseLogFileResult', () => {
  it('fills in defaults for fields the daemon could not supply', () => {
    // daemon never started: no device id, no uptime
    const res = parseLogFileResult(
      '{"path":"/tmp/x.txt","bytes":12,"version":"v1.30.0","os":"android","arch":"arm64","deviceId":"","uptimeSec":0,"goroutines":7}',
    );
    expect(res).toEqual({
      path: '/tmp/x.txt',
      bytes: 12,
      version: 'v1.30.0',
      os: 'android',
      arch: 'arm64',
      deviceId: '',
      uptimeSec: 0,
      goroutines: 7,
    });
  });

  it('throws on error or missing path', () => {
    expect(() => parseLogFileResult('{"error":"destination path is empty"}')).toThrow(
      'destination path is empty',
    );
    expect(() => parseLogFileResult('{"bytes":3}')).toThrow('no path');
  });
});

describe('formatLogHeader', () => {
  it('omits lines for facts the daemon could not supply', () => {
    const header = formatLogHeader({
      exportedAt: '2026-10-05T10:00:00.000Z',
      platform: 'android 34',
      syncthingVersion: 'v1.30.0',
      build: 'android/arm64',
      deviceId: '',
      uptimeSec: 0,
      goroutines: 7,
      logBytes: 2048,
    });
    expect(header).toBe(
      [
        '# SyncUp daemon log',
        'exported: 2026-10-05T10:00:00.000Z',
        'platform: android 34',
        'syncthing: v1.30.0',
        'build: android/arm64',
        'goroutines: 7',
        'log size: 2.0 KB',
        '',
        '',
      ].join('\n'),
    );
  });

  it('includes device id and uptime for a running daemon', () => {
    const header = formatLogHeader({
      exportedAt: '2026-10-05T10:00:00.000Z',
      deviceId: 'OM2M7ZF-AIHEN4B',
      uptimeSec: 61,
    });
    expect(header).toContain('device id: OM2M7ZF-AIHEN4B\n');
    expect(header).toContain('uptime: 61s\n');
  });
});
