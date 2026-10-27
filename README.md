# BIOS TV

Launcher personale per Google TV, in stile Apple TV con l'identità visiva di BIOS.
Zero pubblicità, zero account, zero API a pagamento: il saluto "alla Jarvis" è composto
sulla TV dai tuoi dati e letto dalla voce offline di Android.

## Cosa fa

- **Home a tutto schermo** con orologio, data e meteo. Tema *Paesaggio*: montagne disegnate
  sulla TV, diverse ogni giorno, con il cielo che segue alba e tramonto reali. Tema *Monolith*:
  il nero di BIOS.
- **Saluto vocale** all'accensione o dopo qualche ora: ora, meteo, prossimo impegno,
  allenamento del giorno, conto alla rovescia, focus della settimana. Di notte ti ricorda di dormire.
- **La tua giornata**: prossimo impegno, allenamento (OK sulla card per segnarlo fatto),
  focus, meteo.
- **App** con le copertine ufficiali, effetto luce al passaggio, colore di sfondo che segue l'app.
  Tieni premuto OK per riordinarle.
- **Gestione dal telefono**: la TV mostra un indirizzo e un PIN; dal telefono, sulla stessa
  rete Wi-Fi, modifichi agenda, allenamenti, focus, città, tema e app visibili.

Meteo: Open-Meteo (gratuito, senza chiave). Posizione: dalla città impostata, oppure dalla rete.
Tutti i dati restano in un file sulla TV.

## Telecomando

| Tasto | Azione |
|---|---|
| Frecce | Muoversi |
| OK | Apri app / azione della card |
| OK tenuto premuto su un'app | Riordina (frecce per spostare, OK per confermare) |
| Indietro | Chiudi pannello / torna alla prima app |
| Menu o icona ingranaggio | Impostazioni: indirizzo e PIN, voce, tema, tasto Home |

## Come ottenere l'APK

Ogni push su `main` avvia GitHub Actions, che compila l'app e la pubblica come release.
Link fisso all'ultima versione:

```
https://github.com/<utente>/<repo>/releases/latest/download/bios-tv.apk
```

## Installazione sulla TV

1. Sulla TV: *Impostazioni → Sistema → Info*, premi 7 volte su *Build del sistema operativo*
   (attiva le opzioni sviluppatore).
2. Installa **Downloader** (di AFTVnews) dal Play Store.
3. *Impostazioni → App → Sicurezza e limitazioni → Origini sconosciute*: abilita Downloader.
4. Apri Downloader, inserisci il link dell'APK, installa.
5. Apri **BIOS TV**. Ingranaggio in alto a destra → *Tasto Home apre BIOS* → attiva
   *BIOS TV · Tasto Home*. Da qui in poi il tasto Home e l'accensione portano a BIOS.

Se l'interruttore è grigio ("impostazione con restrizioni", Android 13+), sbloccalo una volta da un computer:

```
adb connect <ip-della-tv>
adb shell appops set it.filippo.biostv ACCESS_RESTRICTED_SETTINGS allow
```

In alternativa, un'app come *TVQuickActions* può assegnare il tasto Home a BIOS TV.

## Dal telefono

Apri l'indirizzo mostrato nelle impostazioni della TV (es. `http://192.168.1.42:8765`),
inserisci il PIN. Su iPhone: Condividi → *Aggiungi alla schermata Home*.

## Voce

Usa il motore vocale della TV. Se non parla italiano: *Impostazioni → Sistema → Accessibilità →
Sintesi vocale* e scegli italiano, oppure aggiorna *Servizi di sintesi vocale Google*.
Orari di silenzio e on/off si impostano dal telefono.

## Note tecniche

- Java + WebView, nessuna dipendenza esterna. UI in `app/src/main/assets/www`, pagina telefono in `assets/phone`.
- La chiave di firma è nel repo, così ogni nuova versione si installa sopra la precedente. Non contiene dati personali.
- Font: Inter (SIL Open Font License) e DejaVu Sans Mono, inclusi e ridotti ai caratteri latini.
- Anteprima nel browser: apri `app/src/main/assets/www/index.html` (dati di esempio, frecce + Invio, `h` per riordinare, `m` per il menu).
