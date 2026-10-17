package gobridge

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/syncthing/syncthing/lib/build"
	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/events"
	"github.com/syncthing/syncthing/lib/locations"
	"github.com/syncthing/syncthing/lib/protocol"
	"github.com/syncthing/syncthing/lib/svcutil"
	stlib "github.com/syncthing/syncthing/lib/syncthing"
)

const (
	wrapperVersion = "v0.0.1"
	defaultGUIAddr = "127.0.0.1:8384"
	configFileName = "config.xml"
	certFileName   = "cert.pem"
	keyFileName    = "key.pem"
	lockFileName   = "syncthing.lock"
)

type Client struct {
	mu       sync.Mutex
	app      *stlib.App
	config   config.Wrapper
	cancel   context.CancelFunc
	ctx      context.Context
	evLogger events.Logger

	deviceID    string
	apiKey      string
	guiAddress  string
	port        int
	dataDir     string
	foldersRoot string

	// auto-paused by run-condition monitor; resumed together on SetSuspended(false).
	// in-memory, so a restart drops the set and auto-paused folders stay paused
	// until the next condition cycle (toggle wifi-only to recover).
	autoPaused map[string]bool
}

func init() {
	build.Version = wrapperVersion
	build.Host = "siddarthkay"
	build.User = "syncup"
}

func defaultPaths() (configDir, dataDir string) {
	base := filepath.Join(os.TempDir(), "syncup")
	return base, base
}

func (c *Client) Load(configDir, dataDir string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.app != nil {
		return errors.New("client already loaded")
	}

	if configDir == "" || dataDir == "" {
		configDir, dataDir = defaultPaths()
	}
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	c.dataDir = dataDir

	// Set CWD to dataDir so relative folder paths (e.g. "memes") resolve
	// to a persistent location, not the app bundle which is replaced on
	// every install.
	_ = os.Chdir(dataDir)

	locations.SetBaseDir(locations.ConfigBaseDir, configDir)
	locations.SetBaseDir(locations.DataBaseDir, dataDir)
	locations.SetBaseDir(locations.UserHomeBaseDir, dataDir)

	c.ctx, c.cancel = context.WithCancel(context.Background())
	c.evLogger = events.NewLogger()
	go c.evLogger.Serve(c.ctx)

	cert, err := stlib.LoadOrGenerateCertificate(
		locations.Get(locations.CertFile),
		locations.Get(locations.KeyFile),
	)
	if err != nil {
		c.cancel()
		return err
	}
	devID := protocol.NewDeviceID(cert.Certificate[0])
	c.deviceID = devID.String()

	cfgFile := locations.Get(locations.ConfigFile)
	cfg, _, err := config.Load(cfgFile, devID, c.evLogger)
	if err != nil {
		newCfg := config.New(devID)
		cfg = config.Wrap(cfgFile, newCfg, devID, c.evLogger)
	}
	go cfg.Serve(c.ctx)

	waiter, err := cfg.Modify(func(conf *config.Configuration) {
		conf.GUI.Enabled = true
		if conf.GUI.RawAddress == "" {
			conf.GUI.RawAddress = defaultGUIAddr
		}
		// Coexist with another syncthing on the device (e.g. the deprecated
		// syncthing-android app) by roaming off any GUI port that's already
		// bound on loopback. We rebind on every Load so a previously-roamed
		// port returns to 8384 once the other app is gone.
		conf.GUI.RawAddress = pickFreeGUIAddress(conf.GUI.RawAddress)
		if conf.GUI.APIKey == "" {
			conf.GUI.APIKey = randomAPIKey()
		}
		conf.GUI.RawUseTLS = false
		conf.Options.CREnabled = false
		conf.Options.URAccepted = -1
		conf.Options.CRURL = ""
		conf.Options.URURL = ""
		conf.Options.ReleasesURL = ""
		conf.Defaults.Folder.IgnorePerms = true
		// fix for https://github.com/siddarthkay/syncup/issues/11
		// Anchor to foldersRoot so auto-accepts land in the same accessible location as manually-added folders.
		effectiveFoldersRoot := c.foldersRoot
		if effectiveFoldersRoot == "" {
			effectiveFoldersRoot = filepath.Join(dataDir, "folders")
		}
		conf.Defaults.Folder.Path = effectiveFoldersRoot

		// drop stub folders left by earlier bad submits
		kept := conf.Folders[:0]
		for _, f := range conf.Folders {
			if f.ID == "" || f.Path == "" {
				slog.Warn("dropping stub folder", "id", f.ID, "path", f.Path)
				continue
			}
			kept = append(kept, f)
		}
		conf.Folders = kept

		// Heal folders whose Path is a SAF tree URI but whose FilesystemType
		// was written as "basic" (e.g. from an older build that predated SAF
		// support, or an auto-accepted share that inherited the default).
		for i := range conf.Folders {
			f := &conf.Folders[i]
			if strings.HasPrefix(f.Path, "content://") && f.FilesystemType != config.FilesystemType(FilesystemTypeSAF) {
				slog.Warn("promoting content:// folder to SAF filesystem",
					"id", f.ID, "from", string(f.FilesystemType))
				f.FilesystemType = config.FilesystemType(FilesystemTypeSAF)
				conf.SetFolder(*f)
			}
		}

		// iOS rotates the app container UUID on reinstall, so stored absolute
		// paths can point at a dead container. Remap under current dataDir,
		// keeping everything after "/folders/".
		const marker = "/folders/"
		for _, f := range conf.Folders {
			if _, err := os.Stat(f.Path); err == nil {
				continue
			}
			idx := strings.LastIndex(f.Path, marker)
			if idx < 0 {
				continue
			}
			tail := f.Path[idx+len(marker):]
			remapped := filepath.Join(dataDir, "folders", tail)
			if remapped == f.Path {
				continue
			}
			slog.Warn("remapping stale folder path", "id", f.ID, "from", f.Path, "to", remapped)
			if err := os.MkdirAll(remapped, 0o700); err != nil {
				slog.Error("mkdir remapped path failed", "path", remapped, "err", err)
				continue
			}
			f.Path = remapped
			conf.SetFolder(f)
		}

		// Migrate legacy dataDir/folders to foldersRoot if it changed (Android
		// MANAGE_EXTERNAL_STORAGE grant flips it to primary external storage).
		// Done inside cfg.Modify so the rename + config update land before
		// stlib.New spins up any scanner/watcher/puller. Skip on destination
		// collision to never clobber user data.
		if c.foldersRoot != "" {
			legacyRoot := filepath.Join(dataDir, "folders")
			if c.foldersRoot != legacyRoot {
				for i := range conf.Folders {
					f := &conf.Folders[i]
					if !strings.HasPrefix(f.Path, legacyRoot+string(os.PathSeparator)) && f.Path != legacyRoot {
						continue
					}
					rel := strings.TrimPrefix(f.Path, legacyRoot)
					rel = strings.TrimPrefix(rel, string(os.PathSeparator))
					newPath := filepath.Join(c.foldersRoot, rel)
					if newPath == f.Path {
						continue
					}
					if _, err := os.Stat(newPath); err == nil {
						slog.Warn("migrate: destination exists, skipping",
							"id", f.ID, "from", f.Path, "to", newPath)
						continue
					}
					if err := os.MkdirAll(filepath.Dir(newPath), 0o700); err != nil {
						slog.Error("migrate: mkdir parent failed",
							"id", f.ID, "dest", newPath, "err", err)
						continue
					}
					if _, err := os.Stat(f.Path); err != nil {
						// source gone; rewrite path so first scan lands in the new spot
						slog.Warn("migrate: source missing, rewriting path only",
							"id", f.ID, "from", f.Path, "to", newPath)
						if err := os.MkdirAll(newPath, 0o700); err != nil {
							slog.Error("migrate: mkdir dest failed",
								"id", f.ID, "dest", newPath, "err", err)
							continue
						}
						f.Path = newPath
						conf.SetFolder(*f)
						continue
					}
					if err := moveDir(f.Path, newPath); err != nil {
						slog.Error("migrate: move failed",
							"id", f.ID, "from", f.Path, "to", newPath, "err", err)
						continue
					}
					slog.Info("migrate: moved folder",
						"id", f.ID, "from", f.Path, "to", newPath)
					f.Path = newPath
					conf.SetFolder(*f)
				}
			}
		}
	})
	if err != nil {
		c.cancel()
		return err
	}
	waiter.Wait()
	if err := cfg.Save(); err != nil {
		c.cancel()
		return err
	}
	c.config = cfg
	c.apiKey = cfg.GUI().APIKey
	c.guiAddress = cfg.GUI().RawAddress
	c.port = parsePort(c.guiAddress)

	dbPath := locations.Get(locations.Database)
	sdb, err := stlib.OpenDatabase(dbPath, time.Duration(4320)*time.Hour)
	if err != nil {
		c.cancel()
		return err
	}

	opts := stlib.Options{
		NoUpgrade: true,
	}
	app, err := stlib.New(cfg, sdb, c.evLogger, cert, opts)
	if err != nil {
		c.cancel()
		return err
	}
	c.app = app
	return nil
}

func (c *Client) Start() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return errors.New("call Load first")
	}
	return c.app.Start()
}

func (c *Client) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.Stop(svcutil.ExitSuccess)
	c.cancel()
	c.app.Wait()
	c.app = nil
	c.config = nil
}

// SetSuspended pauses/resumes folders for run-condition changes (wifi-only,
// charging-only) without touching user-paused folders. Pause records each
// folder it flipped; resume only touches that set and clears it.
func (c *Client) SetSuspended(suspended bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.config == nil {
		return errors.New("config not loaded")
	}
	if c.autoPaused == nil {
		c.autoPaused = make(map[string]bool)
	}
	waiter, err := c.config.Modify(func(conf *config.Configuration) {
		for i := range conf.Folders {
			f := &conf.Folders[i]
			if suspended {
				if !f.Paused {
					c.autoPaused[f.ID] = true
					f.Paused = true
				}
			} else {
				if c.autoPaused[f.ID] {
					f.Paused = false
					delete(c.autoPaused, f.ID)
				}
			}
		}
	})
	if err != nil {
		return err
	}
	waiter.Wait()
	return c.config.Save()
}

func (c *Client) APIKey() string           { return c.apiKey }
func (c *Client) DeviceID() string         { return c.deviceID }
func (c *Client) GUIAddress() string       { return c.guiAddress }
func (c *Client) Port() int                { return c.port }
func (c *Client) DataDir() string          { return c.dataDir }
func (c *Client) Version() string          { return build.Version }
func (c *Client) SyncthingVersion() string { return build.LongVersion }

// FoldersRoot is the base dir for new folders and the picker sandbox.
// Defaults to dataDir+"/folders".
func (c *Client) FoldersRoot() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.foldersRoot != "" {
		return c.foldersRoot
	}
	if c.dataDir == "" {
		return ""
	}
	return filepath.Join(c.dataDir, "folders")
}

// folderFSPaths returns the POSIX Path of every configured folder that uses a
// real filesystem path (not a content:// SAF tree URI). CopyFile treats these
// as extra sandbox roots so photo backup can write into a folder the daemon
// already syncs — e.g. an All-Files-Access DCIM folder outside foldersRoot.
func (c *Client) folderFSPaths() []string {
	c.mu.Lock()
	cfg := c.config
	c.mu.Unlock()
	if cfg == nil {
		return nil
	}
	var paths []string
	for _, f := range cfg.Folders() {
		if f.Path == "" || strings.HasPrefix(f.Path, "content://") {
			continue
		}
		paths = append(paths, f.Path)
	}
	return paths
}

// safTreeForPath resolves a content:// destination to the tree URI of the SAF
// folder that contains it plus the path relative to that folder's root. ok is
// false when no configured SAF folder is a parent of p. Used by CopyFile so
// photo backup can write into SAF-backed folders, whose Path is an opaque
// content:// tree URI rather than a POSIX path. Unexported so gomobile doesn't
// try to bind its three-value return (bind allows at most one value + error).
func (c *Client) safTreeForPath(p string) (treeURI, rel string, ok bool) {
	c.mu.Lock()
	cfg := c.config
	c.mu.Unlock()
	if cfg == nil {
		return "", "", false
	}
	for _, f := range cfg.Folders() {
		if f.FilesystemType != config.FilesystemType(FilesystemTypeSAF) {
			continue
		}
		root := f.Path
		if p == root {
			return root, "", true
		}
		if strings.HasPrefix(p, root+"/") {
			return root, strings.TrimPrefix(p, root+"/"), true
		}
	}
	return "", "", false
}

// SetFoldersRoot updates the base dir + sandbox allow-list. Existing folder
// configs keep their stored paths; migration happens in Load.
func (c *Client) SetFoldersRoot(path string) error {
	if path == "" {
		return errors.New("foldersRoot is empty")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return err
	}
	c.mu.Lock()
	c.foldersRoot = abs
	cfg := c.config
	c.mu.Unlock()

	// Keep Defaults.Folder.Path aligned so future auto-accepts land here too.
	if cfg != nil {
		waiter, err := cfg.Modify(func(conf *config.Configuration) {
			conf.Defaults.Folder.Path = abs
		})
		if err != nil {
			return err
		}
		waiter.Wait()
		if err := cfg.Save(); err != nil {
			return err
		}
	}
	return nil
}

// moveDir tries os.Rename then falls back to copy+remove on EXDEV. The
// Android app-scoped FUSE mount always returns EXDEV against primary
// external storage, so copy is the hot path for that migration.
func moveDir(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	} else if !errors.Is(err, syscall.EXDEV) {
		return err
	}
	if err := copyDir(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	return os.RemoveAll(src)
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()
	dstFile, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer dstFile.Close()
	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return err
	}
	return dstFile.Sync()
}

// pickFreeGUIAddress returns preferred if its port is bindable, otherwise
// scans the next 15 ports on the same host, otherwise falls back to ":0"
// (kernel-assigned). The probe binds and immediately closes, so syncthing's
// own listener takes the port a moment later. There could be a race condition but lets see.
func pickFreeGUIAddress(preferred string) string {
	host, portStr, err := net.SplitHostPort(preferred)
	if err != nil {
		host, portStr = "127.0.0.1", "8384"
	}
	basePort, err := strconv.Atoi(portStr)
	if err != nil || basePort <= 0 {
		basePort = 8384
	}
	for off := 0; off < 16; off++ {
		candidate := net.JoinHostPort(host, strconv.Itoa(basePort+off))
		if isBindable(candidate) {
			return candidate
		}
	}
	// Last resort: let the kernel pick. parsePort + downstream UI handle
	// arbitrary ports fine since they read from GUIAddress().
	ephemeral := net.JoinHostPort(host, "0")
	if ln, err := net.Listen("tcp", ephemeral); err == nil {
		addr := ln.Addr().String()
		_ = ln.Close()
		return addr
	}
	return preferred
}

func isBindable(addr string) bool {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func parsePort(addr string) int {
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		slog.Warn("parsePort failed", "addr", addr, "err", err)
		return 0
	}
	p, err := strconv.Atoi(portStr)
	if err != nil {
		return 0
	}
	return p
}

func randomAPIKey() string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 32)
	if _, err := readRand(b); err != nil {
		return "changeme-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return string(b)
}
