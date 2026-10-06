package gobridge

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type systemLogJSON struct {
	Messages []struct {
		When    time.Time `json:"when"`
		Message string    `json:"message"`
		Level   string    `json:"level"`
	} `json:"messages"`
}

func decodeSystemLog(t *testing.T, raw string) systemLogJSON {
	t.Helper()
	var out systemLogJSON
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("bad JSON %q: %v", raw, err)
	}
	return out
}

func TestGetSystemLog(t *testing.T) {
	m := NewMobileAPI()
	marker := "logs_test marker " + t.Name()
	slog.Warn(marker)

	all := decodeSystemLog(t, m.GetSystemLog("", 0))
	var found bool
	for _, l := range all.Messages {
		if strings.Contains(l.Message, marker) {
			found = true
			if l.Level != "WRN" {
				t.Errorf("level = %q, want WRN", l.Level)
			}
		}
	}
	if !found {
		t.Fatalf("marker not in log: %q", all.Messages)
	}

	tail := decodeSystemLog(t, m.GetSystemLog("", 1))
	if len(tail.Messages) != 1 {
		t.Fatalf("limit=1 returned %d lines", len(tail.Messages))
	}
	if !strings.Contains(tail.Messages[0].Message, marker) {
		t.Errorf("tail = %q, want the marker (newest line)", tail.Messages[0].Message)
	}

	future := time.Now().Add(time.Hour).Format(time.RFC3339)
	none := decodeSystemLog(t, m.GetSystemLog(future, 0))
	if len(none.Messages) != 0 {
		t.Errorf("since=future returned %d lines", len(none.Messages))
	}
	// messages must be [] not null so JS callers can iterate without a guard
	if raw := m.GetSystemLog(future, 0); !strings.Contains(raw, `"messages":[]`) {
		t.Errorf("empty result = %s, want \"messages\":[]", raw)
	}

	// garbage since behaves like no since, as the REST endpoint does
	garbage := decodeSystemLog(t, m.GetSystemLog("not-a-time", 0))
	if len(garbage.Messages) == 0 {
		t.Error("unparseable since dropped every line")
	}
}

func TestWriteSystemLog(t *testing.T) {
	m := NewMobileAPI()
	marker := "logs_test marker " + t.Name()
	slog.Error(marker)

	dst := filepath.Join(t.TempDir(), "nested", "log.txt")
	var res struct {
		Path       string `json:"path"`
		Bytes      int64  `json:"bytes"`
		Version    string `json:"version"`
		OS         string `json:"os"`
		Arch       string `json:"arch"`
		Goroutines int    `json:"goroutines"`
		Error      string `json:"error"`
	}
	raw := m.WriteSystemLog(dst)
	if err := json.Unmarshal([]byte(raw), &res); err != nil {
		t.Fatalf("bad JSON %q: %v", raw, err)
	}
	if res.Error != "" {
		t.Fatalf("error = %q", res.Error)
	}
	if res.Path != dst {
		t.Errorf("path = %q, want %q", res.Path, dst)
	}
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(data)) != res.Bytes || res.Bytes == 0 {
		t.Errorf("bytes = %d, file has %d", res.Bytes, len(data))
	}
	if !strings.Contains(string(data), "ERR "+marker) {
		t.Errorf("file missing %q:\n%s", "ERR "+marker, data)
	}
	// each line is "<RFC3339> <LVL> <message>"; RFC3339 is the same stamp
	// the JSON endpoint carries, so a reader can line them up
	first := strings.SplitN(string(data), "\n", 2)[0]
	fields := strings.SplitN(first, " ", 3)
	if len(fields) != 3 {
		t.Fatalf("line %q not '<when> <level> <message>'", first)
	}
	if _, err := time.Parse(time.RFC3339, fields[0]); err != nil {
		t.Errorf("timestamp %q: %v", fields[0], err)
	}
	if res.OS == "" || res.Arch == "" || res.Version == "" || res.Goroutines == 0 {
		t.Errorf("meta incomplete: %+v", res)
	}
}

func TestWriteSystemLogErrors(t *testing.T) {
	m := NewMobileAPI()
	for _, dst := range []string{"", filepath.Join(t.TempDir(), "a-file-not-a-dir", "x", "log.txt")} {
		if dst != "" {
			// make the parent path a file so MkdirAll fails
			if err := os.WriteFile(filepath.Dir(filepath.Dir(dst)), nil, 0o600); err != nil {
				t.Fatal(err)
			}
		}
		raw := m.WriteSystemLog(dst)
		if !strings.Contains(raw, `"error"`) {
			t.Errorf("WriteSystemLog(%q) = %s, want error", dst, raw)
		}
	}
}
