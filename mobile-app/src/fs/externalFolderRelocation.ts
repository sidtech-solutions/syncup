
/** One entry of GoBridge.getPersistedExternalFolders(). */
export interface PersistedExternalFolder {
  id: string;
  path: string;
  displayName?: string;
  isStale?: boolean;
  /** iOS only: every path this bookmark previously resolved to. */
  previousPaths?: string[];
}

export function parsePersistedExternalFolders(raw: string): PersistedExternalFolder[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is PersistedExternalFolder =>
      !!e && typeof e === 'object' && typeof (e as PersistedExternalFolder).path === 'string',
  );
}

/** iOS reports the same directory as /var/... or /private/var/... */
function normalizePath(p: string): string {
  let out = p.startsWith('/private/') ? p.slice('/private'.length) : p;
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function findRelocatedExternalFolderPath(
  entries: PersistedExternalFolder[],
  oldPath: string,
): string | null {
  // An entry currently at oldPath wins: nothing to relocate.
  if (entries.some(e => samePath(e.path, oldPath))) return null;
  const moved = entries.find(e =>
    (e.previousPaths ?? []).some(p => samePath(p, oldPath)),
  );
  if (!moved || samePath(moved.path, oldPath)) return null;
  return moved.path;
}

export function basename(p: string): string {
  return normalizePath(p).split('/').filter(Boolean).pop() ?? '';
}

export function classifyRegrantPick(
  entries: PersistedExternalFolder[],
  oldPath: string,
  pickedPath: string,
): 'same' | 'known' | 'likely' | 'different' {
  if (samePath(oldPath, pickedPath)) return 'same';
  const relocated = findRelocatedExternalFolderPath(entries, oldPath);
  if (relocated && samePath(relocated, pickedPath)) return 'known';
  if (basename(oldPath) && basename(oldPath) === basename(pickedPath)) return 'likely';
  return 'different';
}
