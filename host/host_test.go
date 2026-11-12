package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPathPart(t *testing.T) {
	for _, bad := range []string{"", "..", "foo/../bar", "CON", "C:", "../secret", "a\\b", "file. ", "name."} {
		if err := pathPart(bad); err == nil {
			t.Errorf("accepted unsafe component: %q", bad)
		}
	}
	for _, good := range []string{"Conversazione", "ChatGPT_Backups", "mio-progetto_2026", "Prova 123"} {
		if err := pathPart(good); err != nil {
			t.Errorf("rejected valid component %q: %v", good, err)
		}
	}
}
func TestSafeTarget(t *testing.T) {
	root := t.TempDir()
	good, err := safeTarget(root, "ChatGPT_Backups", "Conversation_abc", "snapshot_2026-11-12_12-05-31_abcdef12.zip")
	if err != nil || !strings.HasPrefix(good, root) {
		t.Fatalf("good path: %v %q", err, good)
	}
	if _, err := safeTarget(root, "../escape", "Conversation_abc", "snapshot_2026-11-12_12-05-31_abcdef12.zip"); err == nil {
		t.Fatal("traversal accepted")
	}
	if _, err := safeTarget(root, "ok", "Conversation_abc", "../foo.zip"); err == nil {
		t.Fatal("archive traversal accepted")
	}
}
func TestFraming(t *testing.T) {
	var buf bytes.Buffer
	data := []byte(`{"op":"ping"}`)
	if err := binary.Write(&buf, binary.LittleEndian, uint32(len(data))); err != nil {
		t.Fatal(err)
	}
	buf.Write(data)
	req, err := readRequest(&buf)
	if err != nil || req.Op != "ping" {
		t.Fatalf("framing read: %v %#v", err, req)
	}
	var reply bytes.Buffer
	if err := writeReply(&reply, Reply{OK: true, Op: "ping"}); err != nil {
		t.Fatal(err)
	}
	var length uint32
	if err := binary.Read(&reply, binary.LittleEndian, &length); err != nil {
		t.Fatal(err)
	}
	if int(length) != len(reply.Bytes()) {
		t.Fatal("wrong reply length")
	}
}
func TestZipIntegrity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.zip")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	for _, name := range []string{"snapshot/2026/conversazione.json", "snapshot/2026/stato_backup.json"} {
		w, e := z.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = w.Write([]byte("{}")); e != nil {
			t.Fatal(e)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := checkArchive(path); err != nil {
		t.Fatal(err)
	}
}
