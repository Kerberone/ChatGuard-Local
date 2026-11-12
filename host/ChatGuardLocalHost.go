// ChatGuard Local Native Host 1.0.0-beta — offline, single-purpose file writer.
// Native Messaging framing: one little-endian uint32 length + UTF-8 JSON.
// No network listeners, no browser download APIs, no arbitrary file commands.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const (
	Version     = "1.0.0-beta"
	MaxIncoming = 2 * 1024 * 1024
	MaxArchive  = 450 * 1024 * 1024
	MaxChunk    = 192 * 1024
)

type Config struct {
	Root        string `json:"backup_root"`
	ExtensionID string `json:"extension_id"`
}
type Request struct {
	Op           string `json:"op"`
	ID           string `json:"id,omitempty"`
	Seq          int    `json:"seq,omitempty"`
	Folder       string `json:"folder,omitempty"`
	Conversation string `json:"conversation,omitempty"`
	FileName     string `json:"fileName,omitempty"`
	Total        int64  `json:"total,omitempty"`
	Data         string `json:"data,omitempty"`
}
type Reply struct {
	OK      bool   `json:"ok"`
	Op      string `json:"op,omitempty"`
	Error   string `json:"error,omitempty"`
	ID      string `json:"id,omitempty"`
	Seq     int    `json:"seq,omitempty"`
	Root    string `json:"root,omitempty"`
	Path    string `json:"path,omitempty"`
	Bytes   int64  `json:"bytes,omitempty"`
	SHA256  string `json:"sha256,omitempty"`
	Version string `json:"version,omitempty"`
}
type Transfer struct {
	id     string
	file   *os.File
	temp   string
	dest   string
	total  int64
	size   int64
	seq    int
	hasher hash.Hash
}

var extensionIDPattern = regexp.MustCompile(`^[a-p]{32}$`)
var archivePattern = regexp.MustCompile(`^snapshot_[0-9A-Za-z_.-]{12,130}\.zip$`)

func loadConfig() (Config, error) {
	executable, err := os.Executable()
	if err != nil {
		return Config{}, err
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "config.json"))
	if err != nil {
		return Config{}, err
	}
	var config Config
	if err = json.Unmarshal(raw, &config); err != nil {
		return Config{}, err
	}
	if !extensionIDPattern.MatchString(config.ExtensionID) {
		return Config{}, errors.New("ID estensione non valido nel file config.json")
	}
	if !filepath.IsAbs(config.Root) {
		return Config{}, errors.New("Cartella backup non assoluta in config.json")
	}
	config.Root = filepath.Clean(config.Root)
	return config, nil
}
func pathPart(s string) error {
	if s == "" || len([]rune(s)) > 120 || strings.TrimSpace(s) != s || s == "." || s == ".." ||
		strings.Contains(s, "..") || strings.ContainsAny(s, "\\/:*?\"<>|\x00\r\n\t") || strings.HasSuffix(s, ".") {
		return errors.New("Nome cartella non sicuro")
	}
	for _, r := range s {
		if r < 32 {
			return errors.New("Carattere non consentito nel percorso")
		}
	}
	stem := strings.ToUpper(strings.SplitN(s, ".", 2)[0])
	if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
		(len(stem) == 4 && ((strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9')) {
		return errors.New("Nome riservato da Windows")
	}
	return nil
}
func safeTarget(root, folder, conversation, fileName string) (string, error) {
	if err := pathPart(folder); err != nil {
		return "", err
	}
	if err := pathPart(conversation); err != nil {
		return "", err
	}
	if !archivePattern.MatchString(fileName) {
		return "", errors.New("Nome archivio non valido")
	}
	target := filepath.Join(root, folder, conversation, fileName)
	rel, err := filepath.Rel(root, target)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", errors.New("Percorso non autorizzato")
	}
	return target, nil
}
func readRequest(in io.Reader) (Request, error) {
	var length uint32
	if err := binary.Read(in, binary.LittleEndian, &length); err != nil {
		return Request{}, err
	}
	if length == 0 || length > MaxIncoming {
		return Request{}, errors.New("Messaggio oltre limite o vuoto")
	}
	raw := make([]byte, length)
	if _, err := io.ReadFull(in, raw); err != nil {
		return Request{}, err
	}
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return Request{}, err
	}
	return req, nil
}
func writeReply(out io.Writer, reply Reply) error {
	raw, err := json.Marshal(reply)
	if err != nil {
		return err
	}
	if len(raw) > 1024*1024 {
		return errors.New("Risposta troppo grande")
	}
	if err := binary.Write(out, binary.LittleEndian, uint32(len(raw))); err != nil {
		return err
	}
	_, err = out.Write(raw)
	return err
}
func checkArchive(p string) error {
	archive, err := zip.OpenReader(p)
	if err != nil {
		return fmt.Errorf("ZIP non leggibile: %w", err)
	}
	defer archive.Close()
	if len(archive.File) < 2 {
		return errors.New("ZIP senza cronologia sufficiente")
	}
	foundJSON, foundStatus := false, false
	for _, f := range archive.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		if strings.HasPrefix(name, "/") || strings.HasPrefix(name, "../") || strings.Contains(name, "/../") || strings.HasSuffix(name, "/..") {
			return errors.New("Percorso pericoloso nello ZIP")
		}
		if strings.HasSuffix(name, "/conversazione.json") {
			foundJSON = true
		}
		if strings.HasSuffix(name, "/stato_backup.json") {
			foundStatus = true
		}
		reader, e := f.Open()
		if e != nil {
			return e
		}
		_, e = io.Copy(io.Discard, reader)
		e2 := reader.Close()
		if e != nil {
			return fmt.Errorf("Contenuto ZIP danneggiato (%s): %w", name, e)
		}
		if e2 != nil {
			return e2
		}
	}
	if !foundJSON || !foundStatus {
		return errors.New("ZIP senza conversazione.json o stato_backup.json")
	}
	return nil
}
func chooseNewRoot(config Config) (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("La selezione cartella richiede Windows")
	}
	const ps = `Add-Type -AssemblyName System.Windows.Forms; $dlg=New-Object System.Windows.Forms.FolderBrowserDialog; $dlg.Description='Seleziona la cartella principale di ChatGuard Local'; $dlg.ShowNewFolderButton=$true; if($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dlg.SelectedPath)) } else { 'CANCELLED' }`
	command := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", ps)
	out, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("Impossibile aprire la scelta cartella: %w", err)
	}
	choice := strings.TrimSpace(string(out))
	if choice == "CANCELLED" || choice == "" {
		return "", errors.New("Scelta della cartella annullata")
	}
	bytes, err := base64.StdEncoding.DecodeString(choice)
	if err != nil {
		return "", errors.New("La finestra ha restituito un percorso non valido")
	}
	path := filepath.Clean(string(bytes))
	if !filepath.IsAbs(path) {
		return "", errors.New("Il percorso scelto non e assoluto")
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return "", errors.New("La cartella scelta non e accessibile")
	}
	probe, err := os.CreateTemp(path, ".chatguard-probe-*.tmp")
	if err != nil {
		return "", fmt.Errorf("Cartella non scrivibile: %w", err)
	}
	probe.Close()
	os.Remove(probe.Name())
	config.Root = path
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", err
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	configFile := filepath.Join(filepath.Dir(executable), "config.json")
	if err := os.WriteFile(configFile, data, 0600); err != nil {
		return "", fmt.Errorf("Impossibile registrare la scelta: %w", err)
	}
	return path, nil
}
func run(in io.Reader, out io.Writer, conf Config) error {
	var cur *Transfer
	defer func() {
		if cur != nil {
			cur.file.Close()
			os.Remove(cur.temp)
		}
	}()
	for {
		req, err := readRequest(in)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		ans := Reply{OK: false, Op: req.Op, ID: req.ID, Seq: req.Seq}
		switch req.Op {
		case "ping":
			ans.OK = true
			ans.Root = conf.Root
			ans.Version = Version
		case "choose_root":
			if cur != nil {
				ans.Error = "Salvataggio in corso: riprova dopo il backup"
				break
			}
			path, e := chooseNewRoot(conf)
			if e != nil {
				ans.Error = e.Error()
				break
			}
			conf.Root = path
			ans.OK = true
			ans.Root = path
		case "begin":
			if cur != nil {
				ans.Error = "Un backup e gia in corso"
				break
			}
			if req.Total <= 0 || req.Total > MaxArchive {
				ans.Error = "Archivio oltre limite (450 MB)"
				break
			}
			if !regexp.MustCompile(`^[a-zA-Z0-9]{16,48}$`).MatchString(req.ID) {
				ans.Error = "Identificatore trasferimento non valido"
				break
			}
			path, e := safeTarget(conf.Root, req.Folder, req.Conversation, req.FileName)
			if e != nil {
				ans.Error = e.Error()
				break
			}
			if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
				ans.Error = "Impossibile creare cartella: " + e.Error()
				break
			}
			if _, e = os.Stat(path); e == nil {
				ans.Error = "Lo snapshot esiste gia: non sovrascrivo file precedenti"
				break
			}
			if !errors.Is(e, os.ErrNotExist) {
				ans.Error = "Impossibile controllare il file destinazione"
				break
			}
			f, e := os.CreateTemp(filepath.Dir(path), ".chatguard-*.tmp")
			if e != nil {
				ans.Error = "Impossibile creare file temporaneo: " + e.Error()
				break
			}
			cur = &Transfer{id: req.ID, file: f, temp: f.Name(), dest: path, total: req.Total, hasher: sha256.New()}
			ans.OK = true
		case "chunk":
			if cur == nil || cur.id != req.ID {
				ans.Error = "Nessun trasferimento attivo corrispondente"
				break
			}
			if req.Seq != cur.seq {
				ans.Error = "Numero segmento non valido"
				break
			}
			if len(req.Data) > ((MaxChunk+2)/3*4)+4 {
				ans.Error = "Segmento troppo grande"
				break
			}
			decoded, e := base64.StdEncoding.DecodeString(req.Data)
			if e != nil {
				ans.Error = "Dati base64 non validi"
				break
			}
			if len(decoded) == 0 || len(decoded) > MaxChunk || cur.size+int64(len(decoded)) > cur.total {
				ans.Error = "Dimensioni segmento non valide"
				break
			}
			written, e := cur.file.Write(decoded)
			if e != nil || written != len(decoded) {
				ans.Error = "Scrittura file fallita"
				break
			}
			_, _ = cur.hasher.Write(decoded)
			cur.size += int64(written)
			cur.seq++
			ans.OK = true
			ans.Bytes = cur.size
		case "finish":
			if cur == nil || cur.id != req.ID {
				ans.Error = "Trasferimento non trovato"
				break
			}
			if cur.size != cur.total {
				ans.Error = fmt.Sprintf("File incompleto: %d/%d byte", cur.size, cur.total)
				break
			}
			if e := cur.file.Sync(); e != nil {
				ans.Error = "Errore sincronizzazione disco: " + e.Error()
				break
			}
			if e := cur.file.Close(); e != nil {
				ans.Error = "Errore chiusura file: " + e.Error()
				break
			}
			sum := hex.EncodeToString(cur.hasher.Sum(nil))
			if e := checkArchive(cur.temp); e != nil {
				ans.Error = e.Error()
				break
			}
			if _, e := os.Stat(cur.dest); e == nil {
				ans.Error = "Lo snapshot e gia presente"
				break
			}
			if e := os.Rename(cur.temp, cur.dest); e != nil {
				ans.Error = "Impossibile finalizzare lo snapshot: " + e.Error()
				break
			}
			ans.OK = true
			ans.Path = cur.dest
			ans.Bytes = cur.total
			ans.SHA256 = sum
			cur = nil
		default:
			ans.Error = "Operazione non riconosciuta"
		}
		if err := writeReply(out, ans); err != nil {
			return err
		}
	}
}
func main() {
	conf, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "ChatGuard Local: ", err)
		os.Exit(2)
	}
	if len(os.Args) > 1 && os.Args[1] == "--selftest" {
		if err = os.MkdirAll(conf.Root, 0700); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		probe, err := os.CreateTemp(conf.Root, ".chatguard-probe-*.tmp")
		if err != nil {
			fmt.Fprintln(os.Stderr, "Cartella non scrivibile: ", err)
			os.Exit(2)
		}
		probe.Close()
		os.Remove(probe.Name())
		fmt.Println("OK. Host 1.0.0-beta, directory:", conf.Root)
		return
	}
	expected := "chrome-extension://" + conf.ExtensionID
	if len(os.Args) < 2 || (os.Args[1] != expected && os.Args[1] != expected+"/") {
		fmt.Fprintln(os.Stderr, "Origine estensione non autorizzata")
		os.Exit(3)
	}
	if err = run(os.Stdin, os.Stdout, conf); err != nil {
		fmt.Fprintln(os.Stderr, "Errore native messaging:", err)
		os.Exit(4)
	}
}
