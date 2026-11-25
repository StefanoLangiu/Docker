# Minecraft Multi-Bot Management System

Sistema distribuito e containerizzato per l'orchestrazione concorrente di bot su Minecraft, controllato in tempo reale tramite un bot **Telegram** multi-utente e monitorato attraverso una **Dashboard Web** dedicata.

---

## Architettura & Stack Tecnologico

Il sistema è composto da due servizi principali isolati e coordinati tramite **Docker Compose**:

1. **Server Minecraft (PaperMC)**
   * **Core:** PaperMC 1.20.4 (ottimizzato per alte prestazioni).
   * **Infrastruttura:** Container Docker (`itzg/minecraft-server`) con supporto RCON abilitato e plugin **Dynmap** integrato per la visualizzazione cartografica in tempo reale.
   * **Risorse:** Gestione della memoria JVM allocata (4G) con limiti di sicurezza e healthcheck attivi.

2. **Backend & Bot Orchestrator (Node.js)**
   * **Framework Web:** Express.js per l'erogazione della dashboard e delle API di telemetria.
   * **Bot Telegram:** Libreria `Telegraf` per la gestione interattiva dei comandi utente.
   * **Bot Minecraft:** Libreria `Mineflayer` per la simulazione e il controllo programmatico dei client di gioco.
   * **Docker Management:** Libreria `Dockerode` per l'interazione sicura con il demone Docker (assegnazione automatica dei permessi OP tramite esecuzione di comandi RCON sul container di gioco).

---

## Funzionalità Principali

* **Orchestrazione Multi-Bot:** Gestione dinamica di più istanze di bot simultanee tramite una struttura dati in memoria (`Map`), con supporto a limiti di concorrenza per la sicurezza delle risorse.
* **Telemetria in Tempo Reale:** Monitoraggio di CPU, RAM, stato del server e numero di giocatori attivi direttamente dalla dashboard web.
* **Audit Log & Tracciabilità:** Registro delle attività in tempo reale che traccia quale utente Telegram ha generato o mosso ciascun bot.
* **Automazione dei Permessi (OP):** Assegnazione automatica dei privilegi di operatore a ogni bot non appena effettua lo `spawn` nel mondo di gioco.
* **Interfaccia Telegram Condivisibile:** Comandi accessibili sia in chat privata che all'interno di gruppi Telegram.

---

## Guida all'Installazione e Avvio

### Prerequisiti
* Docker e Docker Compose installati sulla macchina.
* Un token valido per il bot Telegram (ottenibile tramite [@BotFather](https://t.me/BotFather)).

### Configurazione
1. Clona la repository del progetto.
2. Crea un file denominato `.env` nella cartella principale inserendo il token del tuo bot Telegram:
   ```env
   TELEGRAM_BOT_TOKEN=il_tuo_token_telegram_qui
   MINECRAFT_HOST=minecraft
   MINECRAFT_PORT=25565
   RCON_PASSWORD=tua_password_rcon_se_necessaria

### Avvio del container
* 
* ```env
docker compose up --build -d

* Una volta avviato:

1. Dashboard Web: Disponibile su http://localhost:3000
2. Mappa Dinamica (Dynmap): Disponibile su http://localhost:8123
3. Bot Telegram: Attivo e pronto a ricevere comandi nella chat configurata.

### Comandi telegram
* **/start**	Mostra il messaggio di benvenuto e l'elenco dei comandi.
* **/spawnbot [nome]**	Fa entrare un nuovo bot nel server (se ometti il nome, usa quello del tuo account Telegram).
* **/esci [nome]**	Disconnette un bot specifico dal server.
* **/sposta <nome> <x> <y> <z>**	Teletrasporta un singolo bot alle coordinate indicate.
* **/tutti <x> <y> <z>**	Teletrasporta simultaneamente tutti i bot attivi verso le coordinate specificate.
* **/lista**	Mostra l'elenco di tutti i bot attualmente attivi e i rispettivi proprietari.

### Dashboard Web e Monitoring
* La dashboard fornisce una panoramica completa dello stato del sistema:
* Stato del Server: Indicatore visivo dello stato di attività del server PaperMC.
* Metriche di Sistema: Consumo di RAM con barra di progresso dinamica e utilizzo della CPU della JVM.
* Feed di Attività (Audit Log): Un terminale integrato che mostra in tempo reale le azioni compiute dagli utenti e dal sistema (es. ingressi, disconnessioni e concessioni di OP).