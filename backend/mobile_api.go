package gobridge

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	cryptozip "github.com/yeka/zip"
)

type MobileAPI struct{}

func NewMobileAPI() *MobileAPI {
	return &MobileAPI{}
}

var (
	globalClient       *Client
	globalMu           sync.Mutex
	pendingFoldersRoot string
	globalSAFBridge    SAFBridge
	// externalRoots is the set of additional sandbox roots registered by the
	// platform layer (iOS scoped folders, after security-scoped resource access
	// has been started). Stored canonicalised (symlinks resolved where the path
	// exists) so prefix-match works across /var ↔ /private/var on iOS.
	externalRoots []string
)

// SetSAFBridge registers the Kotlin-side SAF implementation so the "saf"
// filesystem type can delegate file operations through JNI.
// Must be called before any SAF-backed folder is loaded.
func (m *MobileAPI) SetSAFBridge(bridge SAFBridge) {
	globalMu.Lock()
	defer globalMu.Unlock()
	globalSAFBridge = bridge
}

// RegisterExternalRoot whitelists path as a sandbox root for JS-driven file
// ops (ListSubdirs, MkdirSubdir, RemoveDir, CopyFile dst). Used by iOS after
// resolving a security-scoped bookmark; once the platform layer holds scope,
// the path becomes a regular POSIX path the syncthing core can read/write.
// Idempotent. Path is canonicalised so symlink-equivalent paths match.
func (m *MobileAPI) RegisterExternalRoot(path string) {
	if path == "" {
		return
	}
	canonical := canonicalize(path)
	globalMu.Lock()
	defer globalMu.Unlock()
	for _, r := range externalRoots {
		if r == canonical {
			return
		}
	}
	externalRoots = append(externalRoots, canonical)
}

// UnregisterExternalRoot removes path from the sandbox allow-list. Called by
// iOS when the user revokes a scoped folder.
func (m *MobileAPI) UnregisterExternalRoot(path string) {
	canonical := canonicalize(path)
	globalMu.Lock()
	defer globalMu.Unlock()
	kept := externalRoots[:0]
	for _, r := range externalRoots {
		if r != canonical {
			kept = append(kept, r)
		}
	}
	externalRoots = kept
}

// canonicalize returns an absolute, symlinks-resolved form of p so that
// prefix-matching is stable across /var ↔ /private/var on iOS. Falls back to
// Abs+Clean if the path doesn't exist (so we can still register a root that
// will be created later).
func canonicalize(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	abs = filepath.Clean(abs)
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return resolved
	}
	// Walk up to the deepest existing ancestor, resolve it, then re-attach
	// the missing tail. Lets a not-yet-created path normalize correctly.
	parent := filepath.Dir(abs)
	if parent == abs {
		return abs
	}
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		return filepath.Join(resolved, filepath.Base(abs))
	}
	return abs
}

// ValidateSAFPermission checks whether the app still holds read+write access
// for the given tree URI. Returns true if valid, false if revoked.
func (m *MobileAPI) ValidateSAFPermission(treeURI string) bool {
	globalMu.Lock()
	bridge := globalSAFBridge
	globalMu.Unlock()
	if bridge == nil {
		return false
	}
	return bridge.ValidatePermission(treeURI)
}

func (m *MobileAPI) StartServer(dataDir string) int {
	globalMu.Lock()
	defer globalMu.Unlock()

	if globalClient != nil {
		return globalClient.Port()
	}

	c := &Client{}
	// must run before Load so cfg.Modify sees foldersRoot for the migration step
	if pendingFoldersRoot != "" {
		c.foldersRoot = pendingFoldersRoot
		pendingFoldersRoot = ""
	}
	if err := c.Load(dataDir, dataDir); err != nil {
		slog.Error("syncthing Load failed", "err", err, "dataDir", dataDir)
		return 0
	}
	if err := c.Start(); err != nil {
		slog.Error("syncthing Start failed", "err", err)
		return 0
	}
	globalClient = c
	return c.Port()
}

func (m *MobileAPI) StopServer() {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return
	}
	globalClient.Stop()
	globalClient = nil
}

func (m *MobileAPI) GetServerPort() int {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return 0
	}
	return globalClient.Port()
}

func (m *MobileAPI) GetAPIKey() string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return ""
	}
	return globalClient.APIKey()
}

func (m *MobileAPI) GetDeviceID() string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return ""
	}
	return globalClient.DeviceID()
}

func (m *MobileAPI) GetGUIAddress() string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return ""
	}
	return globalClient.GUIAddress()
}

func (m *MobileAPI) GetDataDir() string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return ""
	}
	return globalClient.DataDir()
}

func (m *MobileAPI) GetFoldersRoot() string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return ""
	}
	return globalClient.FoldersRoot()
}

// SetFoldersRoot sets the root for new folders, picker sandbox, and migration
// destination. Safe before or after StartServer: pre-start it's stashed for
// the next Load; post-start it applies live.
func (m *MobileAPI) SetFoldersRoot(path string) bool {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient != nil {
		if err := globalClient.SetFoldersRoot(path); err != nil {
			slog.Error("SetFoldersRoot live failed", "err", err, "path", path)
			return false
		}
		return true
	}
	pendingFoldersRoot = path
	return true
}

func (m *MobileAPI) SetSuspended(suspended bool) {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return
	}
	if err := globalClient.SetSuspended(suspended); err != nil {
		slog.Error("SetSuspended failed", "err", err, "suspended", suspended)
	}
}

type dirEntryJSON struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

type fsResultJSON struct {
	Path    string         `json:"path,omitempty"`
	Entries []dirEntryJSON `json:"entries,omitempty"`
	Error   string         `json:"error,omitempty"`
}

func currentDataDir() string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return ""
	}
	return globalClient.DataDir()
}

func marshalErr(err error) string {
	b, _ := json.Marshal(fsResultJSON{Error: err.Error()})
	return string(b)
}

// inSandbox returns a cleaned absolute path iff p is under dataDir,
// foldersRoot, or any registered external root. Blocks ".." escapes
// from the JS side.
func inSandbox(p string) (string, error) {
	dataDir := currentDataDir()
	if dataDir == "" {
		return "", errors.New("daemon not started")
	}
	roots := []string{dataDir}
	if r := currentFoldersRoot(); r != "" && r != dataDir {
		roots = append(roots, r)
	}
	globalMu.Lock()
	roots = append(roots, externalRoots...)
	globalMu.Unlock()
	// Configured folder paths count as roots too: the daemon already syncs
	// into them, so JS file ops (photo backup) may target them. Covers
	// All-Files-Access folders (e.g. DCIM) that live outside foldersRoot and
	// aren't registered as externalRoots on Android.
	roots = append(roots, currentFolderPaths()...)
	return inSandboxAtRoots(roots, p)
}

// currentFolderPaths returns the POSIX Path of every configured folder that
// isn't a content:// SAF tree URI.
func currentFolderPaths() []string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return nil
	}
	return globalClient.folderFSPaths()
}

// inSandboxAt is the single-root convenience for tests.
func inSandboxAt(dataDir, p string) (string, error) {
	return inSandboxAtRoots([]string{dataDir}, p)
}

// inSandboxAtRoots accepts a path equal to or separator-anchored under any
// of the roots. Roots and the input are both canonicalised (symlinks
// resolved when possible) so iOS /var ↔ /private/var matches. Pure so
// tests don't need a running daemon.
func inSandboxAtRoots(roots []string, p string) (string, error) {
	if len(roots) == 0 {
		return "", errors.New("no sandbox roots")
	}
	absP, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	absP = filepath.Clean(absP)
	canonP := canonicalize(absP)
	for _, root := range roots {
		if root == "" {
			continue
		}
		absRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		canonRoot := canonicalize(absRoot)
		for _, r := range []string{absRoot, canonRoot} {
			for _, candidate := range []string{absP, canonP} {
				if candidate == r || strings.HasPrefix(candidate, r+string(os.PathSeparator)) {
					return absP, nil
				}
			}
		}
	}
	return "", errors.New("path outside sandbox")
}

func currentFoldersRoot() string {
	globalMu.Lock()
	defer globalMu.Unlock()
	if globalClient == nil {
		return ""
	}
	return globalClient.FoldersRoot()
}

// ListSubdirs returns JSON-encoded immediate children of path, sandboxed.
func (m *MobileAPI) ListSubdirs(path string) string {
	abs, err := inSandbox(path)
	if err != nil {
		return marshalErr(err)
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return marshalErr(err)
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return marshalErr(err)
	}
	result := fsResultJSON{Path: abs, Entries: make([]dirEntryJSON, 0, len(entries))}
	for _, e := range entries {
		name := e.Name()
		// hides .stfolder and other dotfiles
		if strings.HasPrefix(name, ".") {
			continue
		}
		entry := dirEntryJSON{
			Name:  name,
			IsDir: e.IsDir(),
		}
		// best-effort; a broken symlink shouldn't tank the whole listing
		if info, err := e.Info(); err == nil {
			if !e.IsDir() {
				entry.Size = info.Size()
			}
			entry.ModTime = info.ModTime().UTC().Format(time.RFC3339)
		}
		result.Entries = append(result.Entries, entry)
	}
	b, _ := json.Marshal(result)
	return string(b)
}

// ZipDir creates a zip archive of the directory at srcDir and writes it
// to dstPath. Returns JSON with the output path or error.
func (m *MobileAPI) ZipDir(srcDir, dstPath string) string {
	srcAbs, err := filepath.Abs(srcDir)
	if err != nil {
		return marshalErr(err)
	}
	outFile, err := os.Create(dstPath)
	if err != nil {
		return marshalErr(err)
	}
	defer outFile.Close()

	w := zip.NewWriter(outFile)
	defer w.Close()

	err = filepath.Walk(srcAbs, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		// skip hidden files and .stfolder/.stignore
		base := filepath.Base(path)
		if strings.HasPrefix(base, ".st") || strings.HasPrefix(base, ".") {
			return nil
		}
		rel, err := filepath.Rel(srcAbs, path)
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = rel
		header.Method = zip.Deflate
		writer, err := w.CreateHeader(header)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(writer, f)
		return err
	})
	if err != nil {
		os.Remove(dstPath)
		return marshalErr(err)
	}
	b, _ := json.Marshal(fsResultJSON{Path: dstPath})
	return string(b)
}

// ResolvePath returns the absolute path as the daemon sees it. Needed
// because folder.path can be relative and the daemon resolves it from
// its own CWD, which differs from what JS-side path APIs expect.
func (m *MobileAPI) ResolvePath(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		b, _ := json.Marshal(fsResultJSON{Error: err.Error()})
		return string(b)
	}
	b, _ := json.Marshal(fsResultJSON{Path: abs})
	return string(b)
}

// CopyFile copies src to dst. dst must be inside the sandbox; src can be
// any readable path (needed for photo backup where the source is a
// system-managed media path outside the sandbox).
func (m *MobileAPI) CopyFile(src, dst string) string {
	// SAF-backed folders have a content:// tree URI as their root, not a POSIX
	// path, so os.Create can't write into them. Route those through the SAF
	// bridge instead. (Photo backup into a SAF folder hits this path.)
	if strings.HasPrefix(dst, "content://") {
		return copyFileSAF(src, dst)
	}
	absDst, err := inSandbox(dst)
	if err != nil {
		return marshalErr(err)
	}
	if err := os.MkdirAll(filepath.Dir(absDst), 0o755); err != nil {
		return marshalErr(err)
	}
	in, err := os.Open(src)
	if err != nil {
		return marshalErr(err)
	}
	defer in.Close()
	out, err := os.Create(absDst)
	if err != nil {
		return marshalErr(err)
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		os.Remove(absDst)
		return marshalErr(err)
	}
	b, _ := json.Marshal(fsResultJSON{Path: absDst})
	return string(b)
}

// copyFileSAF copies src (a readable POSIX path) into a content:// destination
// inside a SAF-backed folder. dst is resolved to the owning folder's tree URI
// plus a relative path, then written via the SAF filesystem (CreateFile/OpenFd
// over JNI). src stays a plain os.Open since it's a system media path.
func copyFileSAF(src, dst string) string {
	globalMu.Lock()
	client := globalClient
	bridge := globalSAFBridge
	globalMu.Unlock()
	if client == nil {
		return marshalErr(errors.New("daemon not started"))
	}
	if bridge == nil {
		return marshalErr(errors.New("SAF bridge not registered"))
	}
	treeURI, rel, ok := client.safTreeForPath(dst)
	if !ok {
		return marshalErr(errors.New("path outside sandbox"))
	}
	sfs, err := newSAFFilesystem(treeURI)
	if err != nil {
		return marshalErr(err)
	}
	if dir := filepath.Dir(rel); dir != "." && dir != "" {
		if err := sfs.MkdirAll(dir, 0o755); err != nil {
			return marshalErr(err)
		}
	}
	in, err := os.Open(src)
	if err != nil {
		return marshalErr(err)
	}
	defer in.Close()
	out, err := sfs.Create(rel)
	if err != nil {
		return marshalErr(err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = sfs.Remove(rel)
		return marshalErr(err)
	}
	if err := out.Close(); err != nil {
		return marshalErr(err)
	}
	b, _ := json.Marshal(fsResultJSON{Path: dst})
	return string(b)
}

// RemoveDir recursively deletes a sandboxed directory. Refuses the sandbox
// roots themselves so we can't wipe the whole folders dir.
func (m *MobileAPI) RemoveDir(path string) string {
	abs, err := inSandbox(path)
	if err != nil {
		return marshalErr(err)
	}
	dataDir := currentDataDir()
	foldersRoot := currentFoldersRoot()
	if abs == dataDir || abs == foldersRoot || abs == filepath.Join(dataDir, "folders") {
		return marshalErr(errors.New("refusing to remove sandbox root"))
	}
	if err := os.RemoveAll(abs); err != nil {
		return marshalErr(err)
	}
	b, _ := json.Marshal(fsResultJSON{Path: abs})
	return string(b)
}

// ExportConfig zips config.xml, cert.pem, key.pem from srcDataDir to
// dstZipPath. extrasJSON is `[{"name":..., "path":...}, ...]` of additional
// root-level entries.
func (m *MobileAPI) ExportConfig(srcDataDir, dstZipPath, extrasJSON string) string {
	if srcDataDir == "" {
		srcDataDir = currentDataDir()
	}
	if srcDataDir == "" {
		return marshalErr(errors.New("data dir not set"))
	}
	if dstZipPath == "" {
		return marshalErr(errors.New("destination path is empty"))
	}
	for _, name := range backupFiles {
		p := filepath.Join(srcDataDir, name)
		if _, err := os.Stat(p); err != nil {
			return marshalErr(errors.New("missing " + name + ": " + err.Error()))
		}
	}
	var extras []struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	if trimmed := strings.TrimSpace(extrasJSON); trimmed != "" && trimmed != "null" {
		if err := json.Unmarshal([]byte(trimmed), &extras); err != nil {
			return marshalErr(errors.New("extras json: " + err.Error()))
		}
	}
	for _, e := range extras {
		if e.Name == "" || filepath.Base(e.Name) != e.Name {
			return marshalErr(errors.New("extras: invalid name " + e.Name))
		}
		if e.Path == "" {
			return marshalErr(errors.New("extras: empty path for " + e.Name))
		}
	}
	if err := os.MkdirAll(filepath.Dir(dstZipPath), 0o700); err != nil {
		return marshalErr(err)
	}
	out, err := os.Create(dstZipPath)
	if err != nil {
		return marshalErr(err)
	}
	defer out.Close()
	w := zip.NewWriter(out)
	for _, name := range backupFiles {
		if err := addBackupFile(w, filepath.Join(srcDataDir, name), name); err != nil {
			_ = w.Close()
			os.Remove(dstZipPath)
			return marshalErr(err)
		}
	}
	for _, e := range extras {
		if err := addBackupFile(w, e.Path, e.Name); err != nil {
			_ = w.Close()
			os.Remove(dstZipPath)
			return marshalErr(errors.New("extras " + e.Name + ": " + err.Error()))
		}
	}
	if err := w.Close(); err != nil {
		os.Remove(dstZipPath)
		return marshalErr(err)
	}
	b, _ := json.Marshal(fsResultJSON{Path: dstZipPath})
	return string(b)
}

// ImportConfig extracts config.xml, cert.pem, key.pem (required) plus
// https-cert.pem, https-key.pem, syncup-prefs.json, syncup-async.json
// (optional) from srcZipPath into dstDataDir. Syncthing-Fork extras
// (sharedpreferences.dat, files under index-v2) are skipped. password
// decrypts AES-encrypted archives; pass empty for unencrypted. Existing
// files are renamed to .bak and rolled back on failure. Daemon must be
// stopped before calling.
func (m *MobileAPI) ImportConfig(srcZipPath, dstDataDir, password string) string {
	if dstDataDir == "" {
		dstDataDir = currentDataDir()
	}
	if dstDataDir == "" {
		return marshalErr(errors.New("data dir not set"))
	}
	if srcZipPath == "" {
		return marshalErr(errors.New("source path is empty"))
	}
	globalMu.Lock()
	running := globalClient != nil
	globalMu.Unlock()
	if running {
		return marshalErr(errors.New("daemon is running; stop it before import"))
	}
	r, err := cryptozip.OpenReader(srcZipPath)
	if err != nil {
		return marshalErr(err)
	}
	defer r.Close()

	staged := make(map[string][]byte)
	for _, f := range r.File {
		cleaned := filepath.ToSlash(filepath.Clean(f.Name))
		if strings.HasPrefix(cleaned, "/") || strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "/../") {
			return marshalErr(errors.New("unsafe zip entry: " + f.Name))
		}
		if strings.HasSuffix(f.Name, "/") || f.FileInfo().IsDir() {
			continue
		}
		base := filepath.Base(cleaned)
		want, ok := backupWantedFile(base)
		if !ok {
			continue
		}
		if f.IsEncrypted() {
			if password == "" {
				return marshalErr(errors.New("password required: archive is encrypted"))
			}
			f.SetPassword(password)
		}
		if f.UncompressedSize64 > maxBackupEntryBytes {
			return marshalErr(errors.New(base + " too large"))
		}
		rc, err := f.Open()
		if err != nil {
			if f.IsEncrypted() {
				return marshalErr(errors.New("wrong password: " + err.Error()))
			}
			return marshalErr(errors.New(base + ": " + err.Error()))
		}
		data, err := io.ReadAll(io.LimitReader(rc, int64(maxBackupEntryBytes)+1))
		rc.Close()
		if err != nil {
			if f.IsEncrypted() {
				return marshalErr(errors.New("wrong password (decrypt failed): " + err.Error()))
			}
			return marshalErr(err)
		}
		if int64(len(data)) > int64(maxBackupEntryBytes) {
			return marshalErr(errors.New(base + " too large"))
		}
		staged[want] = data
	}
	for _, n := range backupFiles {
		if _, ok := staged[n]; !ok {
			return marshalErr(errors.New("archive missing " + n))
		}
	}
	if err := validateConfigXML(staged[configFileName]); err != nil {
		return marshalErr(err)
	}
	if err := validatePEM(staged[certFileName]); err != nil {
		return marshalErr(errors.New("invalid cert.pem: " + err.Error()))
	}
	if err := validatePEM(staged[keyFileName]); err != nil {
		return marshalErr(errors.New("invalid key.pem: " + err.Error()))
	}
	if data, ok := staged[httpsCertFileName]; ok {
		if err := validatePEM(data); err != nil {
			delete(staged, httpsCertFileName)
		}
	}
	if data, ok := staged[httpsKeyFileName]; ok {
		if err := validatePEM(data); err != nil {
			delete(staged, httpsKeyFileName)
		}
	}

	if err := os.MkdirAll(dstDataDir, 0o700); err != nil {
		return marshalErr(err)
	}

	writeOrder := append([]string(nil), backupFiles...)
	for _, opt := range optionalBackupFiles {
		if _, ok := staged[opt]; ok {
			writeOrder = append(writeOrder, opt)
		}
	}

	backedUp := make([]string, 0, len(writeOrder))
	for _, n := range writeOrder {
		live := filepath.Join(dstDataDir, n)
		bak := live + ".bak"
		_ = os.Remove(bak)
		if _, err := os.Stat(live); err == nil {
			if err := os.Rename(live, bak); err != nil {
				rollbackBackup(dstDataDir, backedUp)
				return marshalErr(err)
			}
			backedUp = append(backedUp, n)
		}
	}
	for i, n := range writeOrder {
		live := filepath.Join(dstDataDir, n)
		if err := os.WriteFile(live, staged[n], 0o600); err != nil {
			for j := 0; j < i; j++ {
				os.Remove(filepath.Join(dstDataDir, writeOrder[j]))
			}
			rollbackBackup(dstDataDir, backedUp)
			return marshalErr(err)
		}
	}
	for _, n := range backedUp {
		os.Remove(filepath.Join(dstDataDir, n+".bak"))
	}

	_, importedPrefs := staged[prefsFileName]
	_, importedAsync := staged[asyncFileName]
	res := struct {
		Path           string `json:"path"`
		ImportedPrefs  bool   `json:"importedPrefs"`
		ImportedAsync  bool   `json:"importedAsync"`
	}{Path: dstDataDir, ImportedPrefs: importedPrefs, ImportedAsync: importedAsync}
	b, _ := json.Marshal(res)
	return string(b)
}

func backupWantedFile(base string) (string, bool) {
	switch base {
	case configFileName, certFileName, keyFileName,
		httpsCertFileName, httpsKeyFileName, prefsFileName, asyncFileName:
		return base, true
	}
	return "", false
}

var backupFiles = []string{configFileName, certFileName, keyFileName}
var optionalBackupFiles = []string{httpsCertFileName, httpsKeyFileName, prefsFileName, asyncFileName}

const (
	httpsCertFileName = "https-cert.pem"
	httpsKeyFileName  = "https-key.pem"
	prefsFileName     = "syncup-prefs.json"
	asyncFileName     = "syncup-async.json"
)

const maxBackupEntryBytes = 32 * 1024 * 1024

func addBackupFile(w *zip.Writer, srcPath, name string) error {
	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()
	hdr := &zip.FileHeader{Name: name, Method: zip.Deflate}
	hdr.SetMode(0o600)
	writer, err := w.CreateHeader(hdr)
	if err != nil {
		return err
	}
	_, err = io.Copy(writer, in)
	return err
}

func validateConfigXML(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return errors.New("config.xml is empty")
	}
	if !strings.Contains(trimmed, "<configuration") {
		return errors.New("config.xml: missing <configuration> root")
	}
	return nil
}

func validatePEM(data []byte) error {
	if len(data) == 0 {
		return errors.New("empty")
	}
	s := string(data)
	if !strings.Contains(s, "-----BEGIN") || !strings.Contains(s, "-----END") {
		return errors.New("missing PEM markers")
	}
	return nil
}

func rollbackBackup(dataDir string, backedUp []string) {
	for _, n := range backedUp {
		live := filepath.Join(dataDir, n)
		bak := live + ".bak"
		_ = os.Remove(live)
		_ = os.Rename(bak, live)
	}
}

// MkdirSubdir creates name under parent (must be sandboxed) and returns
// the new absolute path.
func (m *MobileAPI) MkdirSubdir(parent, name string) string {
	if strings.ContainsAny(name, "/\\") || name == "" || name == "." || name == ".." {
		return marshalErr(errors.New("invalid folder name"))
	}
	absParent, err := inSandbox(parent)
	if err != nil {
		return marshalErr(err)
	}
	newPath := filepath.Join(absParent, name)
	if err := os.MkdirAll(newPath, 0o700); err != nil {
		return marshalErr(err)
	}
	b, _ := json.Marshal(fsResultJSON{Path: newPath})
	return string(b)
}
