# ChatGuard Local

**Backup automatici e locali delle conversazioni ChatGPT per Brave/Chrome su Windows.**

ChatGuard Local è un progetto indipendente, gratuito e open source, con licenza MIT. L'estensione recupera i messaggi disponibili nelle **conversazioni aperte** e li invia tramite **Native Messaging** a un piccolo programma Windows che salva uno ZIP direttamente sul disco: **non usa `chrome.downloads`** e non richiede di disattivare la finestra di conferma dei download del browser.

> **Beta (1.0.0).** Il software è stato sottoposto a test locali, ma non è ancora stato validato su tutte le versioni di Brave/Windows. Non è affiliato a OpenAI o Brave. Non considerarlo l'unica copia dei dati importanti.

## Funzioni

- Backup automatici ogni **3, 5, 10, 15, 30 o 60 minuti**, mentre il browser è aperto e la chat è caricata in una scheda.
- Salvataggio opzionale dopo i nuovi messaggi; le conversazioni non modificate non producono duplicati.
- Snapshot ZIP con **JSON**, **Markdown**, **CSV**, rami alternativi disponibili, metadati e **allegati recuperabili** (immagini, PDF, ZIP, documenti e altro).
- Cronologia temporale e collegamento tra messaggi e allegati nel JSON.
- Stato esplicito **COMPLETO/PARZIALE** in `stato_backup.json`: un file mancante non viene dichiarato salvato.
- Versioni precedenti conservate, nessun aggiornamento distruttivo del backup esistente.
- Cartella principale a scelta tramite finestra Windows; nessuna modifica alle impostazioni globali dei download.
- Nessuna chiave API, abbonamento o servizio cloud aggiuntivo; codice sorgente ispezionabile.

## Installazione su Windows (Brave/Chrome)

**Scarica un pacchetto compilato dalla pagina Releases, quando disponibile, oppure compila il programma seguendo la sezione Sviluppo.** Un archivio con i soli sorgenti GitHub non contiene necessariamente l'eseguibile.

1. Estrai il pacchetto in una cartella permanente e non spostarla dopo aver installato l'estensione.
2. Apri `brave://extensions` (oppure `chrome://extensions`), abilita **Modalità sviluppatore**, scegli **Carica estensione non pacchettizzata** e seleziona la cartella `extension`.
3. Copia l'**ID estensione** (32 lettere) mostrato sulla scheda.
4. Avvia `INSTALLA.cmd` **come utente normale**, incolla quell'ID e scegli la directory principale per i backup.
5. Ricarica l'estensione, apri **Impostazioni → Verifica collegamento** e controlla che compaia il percorso scelto.
6. Apri una conversazione ChatGPT e premi **Salva adesso**; verifica che esista uno ZIP e che all'interno `stato_backup.json` riporti l'esito.

Il programma locale viene registrato per il solo utente Windows (chiavi `HKCU`), senza installare servizi o modificare le preferenze dei download. In caso di errore, verifica che l'ID inserito corrisponda alla versione caricata dell'estensione.

### Come vengono salvati i file

```text
<cartella scelta>/
  ChatGPT_Backups/
    Titolo-conversazione_<ID>/
      snapshot_2026-11-12_12-34-56_xxxxxxxx.zip
        snapshot/<data>/conversazione.json
        snapshot/<data>/conversazione.md
        snapshot/<data>/conversazione.csv
        snapshot/<data>/stato_backup.json
        allegati/<nome-file>
```

I nomi e l'albero sono indicativi. `conversazione.json` include i dati raccolti e le diramazioni che il servizio ha restituito. Il file `stato_backup.json` permette di distinguere i contenuti effettivamente recuperati dai riferimenti mancanti.

## Limiti importanti

- **Non esegue il backup di tutte le conversazioni dell'account:** monitora le chat aperte nelle schede. Se Brave è chiuso non salva nulla.
- Gli endpoint interni di ChatGPT **non sono un'interfaccia pubblica stabile**: possono cambiare e impedire la lettura completa. Il fallback DOM può essere parziale.
- Non può recuperare messaggi o allegati già spariti dai server. Alcuni file hanno URL temporanei o non sono più scaricabili: saranno segnalati come mancanti.
- Massimo **128 MB per allegato**, circa **400 MB per ZIP** nell'estensione. Non garantiamo che tutti i formati o contenuti vengano acquisiti.
- La versione beta è progettata per **Windows 10/11** e browser Chromium supportati; altre piattaforme non hanno ancora un host di installazione.
- Gli ZIP possono contenere **informazioni personali e sensibili** e non sono cifrati. Non pubblicarli su GitHub o in cartelle condivise.

## Privacy e sicurezza

Il programma locale non espone porte di rete, non invia backup a server esterni e accetta trasferimenti attraverso Native Messaging dall'ID autorizzato nell'installazione. L'estensione legge la pagina ChatGPT e usa, dove disponibili, gli endpoint della **sessione già autenticata** per recuperare messaggi e file; non memorizza la password né invia contenuti a servizi terzi. Il codice è leggibile nella cartella `extension/` e in `host/`.

I permessi `tabs`, `scripting`, `storage`, `alarms`, `offscreen`, `nativeMessaging` e l'accesso a domini ChatGPT/oaiusercontent sono utilizzati per individuare le schede, acquisire contenuti, costruire ZIP, salvare impostazioni e scrivere sul disco. **Installa solo codice e binari di cui ti fidi**; l'eseguibile beta non è firmato digitalmente.

Per i dettagli e la segnalazione di vulnerabilità consulta [SECURITY.md](SECURITY.md).

## Sviluppo e test

Requisiti: **Go 1.23+** per l'host, Node.js 20+ per test JavaScript (senza pacchetti npm esterni).

```bash
go test ./host
node --test tests/*.test.cjs
# Linux/macOS: crea l'host per Windows
./scripts/build-windows.sh
```

Su Windows esegui `scripts/build-windows.ps1` e verifica che sia presente `host/ChatGuardLocalHost.exe` prima di usare `INSTALLA.cmd`.

Il binario Windows è escluso da Git: i sorgenti sono la fonte autorevole. L'eventuale ZIP distribuito deve accompagnarsi a un hash SHA-256 verificabile.

## Licenza e contributi

Licenza **MIT**: vedi [LICENSE](LICENSE). Attribuzioni e riconoscimenti: [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). Issue e pull request sono benvenute; consulta [CONTRIBUTING.md](CONTRIBUTING.md). Per disinstallare il solo programma locale usa `DISINSTALLA.cmd`: **non elimina i backup**.

---

*ChatGuard Local è un'applicazione indipendente: non è sviluppata, patrocinata o approvata da OpenAI o Brave.*
