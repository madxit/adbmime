# AdbMime: console web per le lavagne Android

Applicazione web per **trovare, connettere e gestire da remoto** le lavagne interattive Android
che espongono ADB sulla porta TCP **5555**.

Funzioni:

- 🔎 **Rilevamento automatico** delle lavagne accese sulla rete (scansione della porta 5555)
- 🔗 **Connessione ADB** a tutte le lavagne o solo a quelle selezionate, con stato chiaro:
  *Spenta*, *Accesa*, *Da autorizzare*, *Connessa*
- 📦 **Installazione / disinstallazione app** (upload APK, elenco delle app installate)
- 🗑️ **Svuotamento cartelle** (es. `/sdcard/Download`), limitato a percorsi consentiti
- 💬 **Popup di testo** a schermo intero oppure come notifica Android
- 🔊 **Annunci audio**: testo letto ad alta voce (sintesi vocale) o file audio caricato
- ⏻ **Spegnimento**, riavvio e standby dello schermo
- ⌨️ Comando `adb shell` libero (per utenti esperti)
- 🖥️ **Schermo remoto**: vedi lo schermo di una lavagna (anche in modalità *live*) e controllala con clic,
  trascinamenti, pressione lunga, tastiera e tasti di sistema (Indietro, Home, Volume, Power…)
- 🧩 **Sequenze di istruzioni**: crea, salva, **importa ed esporta** sequenze di comandi (tocchi, scorrimenti,
  tasti, testo, pause, apertura app/URL, shell…) ed eseguile tutte insieme sulle lavagne selezionate.
  Le azioni fatte sullo schermo remoto possono essere **registrate** direttamente in una sequenza
- 🌍 **7 lingue**: italiano, inglese, francese, spagnolo, tedesco, portoghese, cinese semplificato
- 🌗 **Tema chiaro, scuro** o automatico (segue il sistema)
- ⚙️ **Impostazioni**: lingua, tema, frequenza di aggiornamento, conferme, informazioni sul server
- 🔐 Accesso con nome utente e password definiti nel file `.env`

---

## 1. Requisiti

| Requisito | Note |
|---|---|
| **Node.js ≥ 20.12** | <https://nodejs.org> (consigliata la versione LTS) |
| **Android platform-tools (`adb`)** | Vedi sotto |
| **Sintesi vocale** (solo per gli annunci audio) | macOS: già inclusa (`say`). Windows: già inclusa. Linux: `espeak-ng` |
| Il PC deve essere **sulla stessa rete** delle lavagne | Le lavagne devono poter raggiungere il PC sulla porta del server (default 8080) |

Installazione di `adb`:

```bash
# macOS
brew install --cask android-platform-tools

# Debian / Ubuntu
sudo apt install adb espeak-ng

# Windows
winget install Google.PlatformTools
```

Verifica con `adb version`. Se `adb` non è nel `PATH`, indica il percorso completo in `ADB_PATH` nel file `.env`.

## 2. Installazione

```bash
cd adbmime
npm install
cp .env.example .env      # su Windows: copy .env.example .env
```

## 3. Avvio del server

```bash
npm start
```

Nel terminale vengono stampati gli indirizzi a cui aprire la console, ad esempio:

```
AdbMime web console
  local:   http://localhost:8080
  network: http://192.168.1.48:8080
  adb:     v1.0.41
```

Apri l'indirizzo nel browser e accedi. **Di default nome utente e password sono vuoti**: premi direttamente *Accedi*.

Per lo sviluppo, `npm run dev` riavvia il server automaticamente a ogni modifica.

Per fermare il server: `Ctrl + C`.

## 4. Configurazione (`.env`)

Tutte le voci sono opzionali; i valori di default sono in `.env.example`.

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Porta e interfaccia del server web. Non usare `127.0.0.1`: le lavagne devono raggiungere il server per popup e audio |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | vuoti | Credenziali di accesso. Se entrambe vuote, si entra con campi vuoti |
| `SESSION_SECRET` | casuale | Chiave per firmare il cookie di sessione. Impostala per non dover rifare il login a ogni riavvio |
| `SESSION_TTL_HOURS` | `12` | Durata della sessione |
| `ADB_PATH` | `adb` | Percorso dell'eseguibile adb |
| `ADB_PORT` | `5555` | Porta ADB delle lavagne |
| `SCAN_SUBNETS` | auto | Reti da scansionare, es. `192.168.1.0/24,192.168.2.0/24`. Se vuoto viene usata la /24 di ogni scheda di rete del PC |
| `SCAN_TIMEOUT_MS` / `SCAN_CONCURRENCY` | `700` / `128` | Tempo di attesa per IP e numero di IP controllati in parallelo |
| `AUTO_SCAN_ON_START` | `true` | Scansiona la rete all'avvio |
| `PUBLIC_BASE_URL` | auto | URL con cui le lavagne raggiungono il server (es. `http://192.168.1.48:8080`). Serve solo se il rilevamento automatico sbaglia (VPN, NAT, più schede di rete) |
| `CLEAR_ALLOWED_ROOTS` | `/sdcard,…` | Radici sotto cui è consentito svuotare cartelle |
| `TTS_VOICE` | auto | Voce della sintesi vocale per l'italiano (macOS: es. `Alice`; Linux: es. `it`). Per le altre lingue viene scelta automaticamente una voce della lingua dell'interfaccia |

> ⚠️ Se le lavagne sono su più reti o su una rete più grande di una /24 (es. `10.0.0.0/22`), imposta `SCAN_SUBNETS`.

## 5. Configurazione necessaria su rete e lavagne

1. **ADB via rete attivo sulle lavagne** (porta 5555). Se una lavagna non ha la porta aperta, collegala via USB una volta ed esegui `adb tcpip 5555`.
2. **Prima connessione**: sulla lavagna può comparire *"Consentire il debug USB?"*. Seleziona **"Consenti sempre da questo computer"** e premi OK. Finché non lo fai la lavagna resta nello stato *Da autorizzare*.
3. **Firewall del PC**: deve consentire le connessioni **in entrata** sulla porta del server (default `8080`), altrimenti le lavagne non riescono a caricare popup e audio.
   - macOS: alla prima esecuzione accetta la richiesta "Consentire connessioni in entrata a node?".
   - Windows: consenti Node.js nelle reti private, oppure `netsh advfirewall firewall add rule name="AdbMime" dir=in action=allow protocol=TCP localport=8080`.
4. **Rete**: il PC deve raggiungere le lavagne sulla porta 5555 (stessa VLAN o regole di routing che lo permettano). Se usi IP statici per le lavagne, puoi aggiungerli con **Aggiungi IP**.
5. **Browser predefinito sulle lavagne** (per i popup a schermo intero) e **lettore multimediale** (per l'audio): se Android chiede ogni volta con quale app aprire, scegli un'app e seleziona *"Sempre"*.

## 6. Uso della console

L'interfaccia è divisa in tre zone: a sinistra l'**elenco compatto delle lavagne**, al centro le **funzioni**
(schede *App, Cartelle, Popup, Audio, Energia, Shell, Schermo remoto, Sequenze*), a destra il pannello **Attività**
(si può nascondere con il pulsante in alto a destra).

1. **Scansiona**: trova le lavagne accese (pallino blu, *Accesa*).
2. Seleziona le lavagne con la casella di ogni riga, con la casella "seleziona tutte" o con i collegamenti
   *Accese / Connesse*. I riquadri in alto (Tutte, Connesse, Accese, Spente) filtrano l'elenco.
3. **Connetti**: le lavagne passano a *Connessa* (pallino verde).
4. Scegli una funzione: verrà eseguita su **tutte le lavagne selezionate e connesse** (la barra sopra le funzioni
   indica quante lavagne riceveranno i comandi).
5. Gli esiti, lavagna per lavagna, compaiono nel pannello **Attività**.

Passando il mouse su una lavagna compaiono le azioni rapide: schermo remoto, connetti/disconnetti, rinomina
(es. *Aula 3B*) e rimuovi. Nomi e lavagne note vengono salvati in `data/devices.json`, così le lavagne spente
restano in elenco.

Le **impostazioni** (icona ⚙️ in alto) permettono di scegliere lingua e tema e mostrano le informazioni del server.
Lingua e tema sono salvati nel browser. La lingua scelta vale anche per i messaggi di errore, per i popup mostrati
sulle lavagne e per la voce della sintesi vocale.

### Schermo remoto

1. Apri la scheda **Schermo remoto** (o l'icona 🖥️ sulla riga di una lavagna connessa) e scegli la lavagna.
2. La schermata viene acquisita con `adb exec-out screencap -p`: premi ⟳ per aggiornarla o attiva **Live**
   (frequenza da 0,5 a 5 secondi).
3. Interazioni sull'immagine:
   - **clic** → tocco (`input tap`);
   - **trascinamento** → scorrimento (`input swipe`);
   - **tieni premuto** (oltre mezzo secondo) → pressione lunga;
   - con l'immagine selezionata puoi **scrivere dalla tastiera**: i caratteri vengono inviati con `input text`;
     Invio, Backspace, frecce, Tab ed Esc (= Indietro) diventano tasti Android.
4. I pulsanti a destra inviano i tasti di sistema (Indietro, Home, App recenti, Menu, Volume, Muto, Power,
   Riattiva, Sospendi, Invio, Cancella). Il campo *Invia testo* digita un testo sulla lavagna.
5. Con **Espandi** lo schermo occupa tutta la finestra; con 💾 salvi lo screenshot.

> `input text` supporta solo caratteri ASCII: le lettere accentate non possono essere digitate da remoto.
> Su lavagne 4K ogni acquisizione può richiedere uno o due secondi.

### Sequenze di istruzioni

Una sequenza è un elenco di passi eseguiti in ordine su ogni lavagna selezionata (le lavagne lavorano in parallelo).
Tipi di passo: *Tocco, Scorrimento, Tasto, Testo, Pausa, Apri app, Apri URL, Comando shell, Disinstalla app,
Nascondi/Mostra app, Commento*.

- **Aggiungi passo** inserisce un passo; ogni passo si modifica direttamente nella riga e si può spostare,
  duplicare o rimuovere.
- **Registra**: nella scheda *Schermo remoto* attiva *Registra le azioni*: tocchi, scorrimenti, tasti e testo
  (ed eventualmente le pause tra un'azione e l'altra) vengono aggiunti alla sequenza aperta.
- **Salva** (anche `Ctrl/⌘ + S`) memorizza la sequenza sul server in `data/sequences.json`, condivisa da tutti
  gli utenti della console.
- **Esegui su N lavagne** avvia la sequenza; con *Interrompi al primo errore* una lavagna si ferma appena un passo
  fallisce. L'esito di ogni passo appare in *Attività*.
- **Esporta / Importa** usano un file di testo con un comando per riga, **compatibile con i file dell'AdbMime
  desktop originale**. Sono accettati anche file JSON (`{ "name": "...", "steps": [...] }`).

Esempio di file esportato:

```
#@name Apri il quiz
# torna alla schermata principale
adb shell input keyevent 3
sleep 1.5
adb shell monkey --pct-syskeys 0 -p org.scuola.quiz 1
sleep 3
adb shell input tap 960 540
adb shell input swipe 200 800 1700 800 300
adb shell input text 'Classe%s3B'
adb shell am start -a android.intent.action.VIEW -d 'https://www.esempio.it'
adb shell settings put system screen_brightness 200
```

Le coordinate sono in pixel dello schermo della lavagna: se le lavagne hanno risoluzioni diverse, registra una
sequenza per ogni modello. Eventuali `-s <seriale>` nelle righe importate vengono ignorati (le lavagne si scelgono
nell'interfaccia); le righe non riconosciute (es. `adb install`) vengono segnalate e saltate.

### Come funzionano popup e audio

- **Popup a schermo intero**: il server crea una pagina temporanea (`/m/<id>`) e la lavagna la apre nel browser
  (`am start -a android.intent.action.VIEW`).
- **Notifica Android**: usa `cmd notification post` (Android 9 o superiore).
- **Audio**: il testo viene trasformato in un file WAV sul PC (`say` / `espeak-ng` / SAPI) e la lavagna lo riproduce
  aprendolo dal server (`/media/<file>`). Il volume, se impostato, usa `cmd media_session volume` o `media volume`.

Pagine e file audio scadono dopo 24 ore.

### Spegnimento

Viene usato `svc power shutdown` e, se non disponibile, `reboot -p`. Su alcuni modelli lo spegnimento
remoto può essere bloccato dal produttore: in tal caso usa *Standby schermo*.

## 7. Struttura del progetto

```
src/
  server.js    rotte HTTP ed avvio
  config.js    lettura del file .env
  auth.js      login e cookie di sessione firmato
  adb.js       wrapper del comando adb
  network.js   rilevamento reti locali e scansione porta 5555
  devices.js   registro delle lavagne e stato delle connessioni
  actions.js   azioni remote (app, cartelle, popup, audio, energia, shell, schermo remoto)
  sequences.js archivio ed esecuzione delle sequenze
  i18n.js      lingua della richiesta (messaggi del server)
  locales.js   traduzioni dei messaggi del server
  tts.js       sintesi vocale lato server (voce nella lingua scelta)
  views.js     pagina del popup mostrata sulle lavagne
  shared/      codice condiviso con il browser (formato delle sequenze)
public/
  index.html, login.html
  js/          moduli dell'interfaccia (lavagne, azioni, schermo, sequenze, impostazioni)
  assets/      stile (tema chiaro/scuro), icone, traduzioni (i18n/), bandiere (flags/)
data/          dati runtime (lavagne note, sequenze, upload, audio) – non versionato
```

## 8. Sicurezza

- Chiunque abbia accesso alla console può eseguire comandi sulle lavagne: **imposta `AUTH_USERNAME` e `AUTH_PASSWORD`** prima di usarla in produzione e imposta un `SESSION_SECRET`.
- La porta ADB 5555 aperta permette il controllo completo delle lavagne a chiunque sia sulla rete: è consigliato isolarle in una VLAN dedicata.
- Le pagine `/m/<id>` e `/media/<file>` sono pubbliche (le lavagne non hanno login) ma usano identificativi casuali non indovinabili.

## 9. Crediti

- Bandiere delle lingue: [Twemoji](https://github.com/jdecked/twemoji) (grafica © Twitter/X e collaboratori,
  licenza [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)), incluse in `public/assets/flags/`.
- Icone dell'interfaccia in stile [Lucide](https://lucide.dev) (licenza ISC).
