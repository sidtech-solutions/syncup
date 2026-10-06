package gobridge

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/syncthing/syncthing/lib/build"
	stlib "github.com/syncthing/syncthing/lib/syncthing"
)

// The app reads the daemon log through here rather than /rest/system/log so
// it still gets a log when the daemon never came up, or came up but the
// device drops loopback traffic (siddarthkay/syncup#73). Both cases are
// exactly when a user is asked for their log.

var serverStartedAt time.Time

// GetSystemLog returns {"messages":[{when,message,level}...]} for lines after
// since (RFC3339; empty means everything). limit > 0 keeps only the newest
// limit lines. Same shape as GET /rest/system/log.
func (m *MobileAPI) GetSystemLog(since string, limit int) string {
	var t time.Time
	if since != "" {
		if parsed, err := time.Parse(time.RFC3339, since); err == nil {
			t = parsed
		}
	}
	b, err := stlib.SystemLogJSON(t, limit)
	if err != nil {
		return marshalErr(err)
	}
	return string(b)
}

type logFileJSON struct {
	Path       string `json:"path"`
	Bytes      int64  `json:"bytes"`
	Version    string `json:"version"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	DeviceID   string `json:"deviceId"`
	UptimeSec  int64  `json:"uptimeSec"`
	Goroutines int    `json:"goroutines"`
}

// WriteSystemLog writes the whole log buffer to dstPath in the
// /rest/system/log.txt format and returns the file size plus the facts the
// app used to fetch from /rest/system/{version,status} for the export
// header. Returns {"error":...} on failure.
func (m *MobileAPI) WriteSystemLog(dstPath string) string {
	if dstPath == "" {
		return marshalErr(errors.New("destination path is empty"))
	}
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o700); err != nil {
		return marshalErr(err)
	}
	f, err := os.Create(dstPath)
	if err != nil {
		return marshalErr(err)
	}
	w := bufio.NewWriter(f)
	if err := stlib.WriteSystemLogTxt(w, time.Time{}); err != nil {
		f.Close()
		os.Remove(dstPath)
		return marshalErr(err)
	}
	if err := w.Flush(); err != nil {
		f.Close()
		os.Remove(dstPath)
		return marshalErr(err)
	}
	if err := f.Close(); err != nil {
		os.Remove(dstPath)
		return marshalErr(err)
	}
	info, err := os.Stat(dstPath)
	if err != nil {
		return marshalErr(err)
	}

	res := logFileJSON{
		Path:       dstPath,
		Bytes:      info.Size(),
		Version:    build.LongVersion,
		OS:         runtime.GOOS,
		Arch:       runtime.GOARCH,
		Goroutines: runtime.NumGoroutine(),
	}
	globalMu.Lock()
	if globalClient != nil {
		res.DeviceID = globalClient.DeviceID()
		if !serverStartedAt.IsZero() {
			res.UptimeSec = int64(time.Since(serverStartedAt).Seconds())
		}
	}
	globalMu.Unlock()
	b, _ := json.Marshal(res)
	return string(b)
}
