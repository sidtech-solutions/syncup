import {
  classifyRegrantPick,
  findRelocatedExternalFolderPath,
  parsePersistedExternalFolders,
  samePath,
} from '../externalFolderRelocation';

const OLD = '/private/var/mobile/Containers/Data/Application/AAAA-1111/Documents/Vault';
const NEW = '/private/var/mobile/Containers/Data/Application/BBBB-2222/Documents/Vault';

describe('samePath', () => {
  it('treats /var and /private/var as the same directory', () => {
    expect(samePath('/var/mobile/x', '/private/var/mobile/x')).toBe(true);
    expect(samePath('/var/mobile/x/', '/private/var/mobile/x')).toBe(true);
    expect(samePath('/var/mobile/x', '/var/mobile/y')).toBe(false);
  });
});

describe('parsePersistedExternalFolders', () => {
  it('tolerates empty, malformed and non-array input', () => {
    expect(parsePersistedExternalFolders('')).toEqual([]);
    expect(parsePersistedExternalFolders('{')).toEqual([]);
    expect(parsePersistedExternalFolders('{"a":1}')).toEqual([]);
    expect(parsePersistedExternalFolders('[null, {"id":"x"}, {"id":"y","path":"/p"}]')).toEqual([
      { id: 'y', path: '/p' },
    ]);
  });
});

describe('findRelocatedExternalFolderPath', () => {
  it('returns the new path when an entry drifted away from the old one', () => {
    const entries = [{ id: '1', path: NEW, previousPaths: [OLD] }];
    expect(findRelocatedExternalFolderPath(entries, OLD)).toBe(NEW);
  });

  it('matches old paths across the /private prefix', () => {
    const entries = [{ id: '1', path: NEW, previousPaths: [OLD] }];
    expect(findRelocatedExternalFolderPath(entries, OLD.replace('/private', ''))).toBe(NEW);
  });

  it('returns null when an entry still lives at the old path', () => {
    const entries = [
      { id: '1', path: OLD },
      { id: '2', path: NEW, previousPaths: [OLD] },
    ];
    expect(findRelocatedExternalFolderPath(entries, OLD)).toBeNull();
  });

  it('returns null when nothing references the old path', () => {
    expect(findRelocatedExternalFolderPath([{ id: '1', path: NEW }], OLD)).toBeNull();
    expect(findRelocatedExternalFolderPath([], OLD)).toBeNull();
  });
});

describe('classifyRegrantPick', () => {
  it('is "same" when the pick equals the stored path', () => {
    expect(classifyRegrantPick([], OLD, OLD)).toBe('same');
    expect(classifyRegrantPick([], OLD, OLD.replace('/private', ''))).toBe('same');
  });

  it('is "known" when the bookmark store recorded the drift', () => {
    const entries = [{ id: '1', path: NEW, previousPaths: [OLD] }];
    expect(classifyRegrantPick(entries, OLD, NEW)).toBe('known');
  });

  it('is "likely" when the store cannot confirm but the folder name matches', () => {
    expect(classifyRegrantPick([], OLD, NEW)).toBe('likely');
    // the dead old entry is still around (bookmark no longer resolves)
    expect(classifyRegrantPick([{ id: '1', path: OLD, isStale: true }], OLD, NEW)).toBe('likely');
  });

  it('is "different" when the name does not match either', () => {
    const other = '/private/var/mobile/Containers/Data/Application/BBBB-2222/Documents/Notes';
    expect(classifyRegrantPick([], OLD, other)).toBe('different');
  });
});
