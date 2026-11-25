const { Telegraf } = require('telegraf');
const mineflayer = require('mineflayer');
const express = require('express');
const Docker = require('dockerode');
const util = require('minecraft-server-util');

const app = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(express.static('public'));

// Mappa bot attivi e array per i log in tempo reale (massimo 20 eventi)
const activeBots = new Map();
const activityLogs = [];
const MAX_LOGS = 20;

function addLog(message) {
    const time = new Date().toLocaleTimeString('it-IT');
    activityLogs.unshift({ time, text: message }); // Aggiunge in cima
    if (activityLogs.length > MAX_LOGS) {
        activityLogs.pop();
    }
}

// Con 10 bot il server disconnette tutti: limite forzato a 9
const MAX_CONCURRENT_BOTS = 9;

function sanitizeMinecraftName(rawName, fallbackId) {
    let clean = (rawName || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (clean.length < 3) {
        clean = `Bot_${String(fallbackId).slice(-5)}`;
    }
    return clean.substring(0, 16);
}

// API per la Dashboard Web (Statistiche + Log unificati)
app.get('/api/stats', async (req, res) => {
  let mcData = { online: false, players: 0, maxPlayers: 0 };
  let dockerData = { ramUsedMB: 0, ramLimitMB: 0, cpuPercent: '0.0' };

  try {
    const status = await util.status(process.env.MINECRAFT_HOST, parseInt(process.env.MINECRAFT_PORT));
    mcData = { online: true, players: status.players.online, maxPlayers: status.players.max };
  } catch (e) {}

  try {
    const container = docker.getContainer('mc_server');
    const stats = await container.stats({ stream: false });
    
    const memUsage = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
    dockerData.ramUsedMB = Math.round(memUsage / 1024 / 1024);
    dockerData.ramLimitMB = Math.round(stats.memory_stats.limit / 1024 / 1024);

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || 1;
    if (systemDelta > 0 && cpuDelta > 0) {
      dockerData.cpuPercent = ((cpuDelta / systemDelta) * numCpus * 100).toFixed(1);
    }
  } catch (e) {}

  res.json({
    ...mcData,
    ...dockerData,
    botConnected: activeBots.size > 0,
    activeBotsCount: activeBots.size,
    botNames: Array.from(activeBots.keys()),
    logs: activityLogs
  });
});

app.listen(3000, () => console.log('Dashboard Web attiva su http://localhost:3000'));

// Gestione Bot Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Restituisce 'OK', 'DUPLICATE' oppure 'FULL'
function createBot(botName, ownerName) {
    if (activeBots.has(botName)) return 'DUPLICATE';
    if (activeBots.size >= MAX_CONCURRENT_BOTS) return 'FULL';

    const mcBot = mineflayer.createBot({
        host: process.env.MINECRAFT_HOST,
        port: parseInt(process.env.MINECRAFT_PORT),
        username: botName,
        version: "1.20.4"
    });

    // Occupa lo slot subito; sarà liberato solo dall'evento 'end'
    activeBots.set(botName, { instance: mcBot, owner: ownerName });

    mcBot.on('spawn', async () => {
        addLog(`🤖 Bot "${botName}" (creato da ${ownerName}) è entrato in gioco.`);
        
        try {
            const mcContainer = docker.getContainer('mc_server');
            const exec = await mcContainer.exec({
                Cmd: ['rcon-cli', `op ${botName}`],
                AttachStdout: true,
                AttachStderr: true
            });
            await exec.start();
            addLog(`🛡️ OP assegnato automaticamente a "${botName}".`);
        } catch (err) {
            addLog(`⚠️ Errore OP per "${botName}": ${err.message}`);
        }
    });

    mcBot.on('kicked', (reason) => {
        addLog(`🥾 Bot "${botName}" espulso: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
    });

    mcBot.on('end', (reason) => {
        addLog(`❌ Bot "${botName}" disconnesso (${reason}).`);
        activeBots.delete(botName);
    });

    mcBot.on('error', (err) => {
        addLog(`⚠️ Errore bot "${botName}": ${err.message}`);
    });

    return 'OK';
}

bot.start((ctx) => {
    const userName = ctx.from.first_name || 'Giocatore';
    addLog(`👤 Utente Telegram ${userName} ha avviato la chat.`);
    ctx.reply(`Ciao ${userName}! Usa /spawnbot per far entrare il tuo bot.`);
});

bot.command('spawnbot', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const senderName = ctx.from.first_name || ctx.from.username || 'Utente';
    const rawRequestedName = args[0] || ctx.from.username || ctx.from.first_name;
    const botName = sanitizeMinecraftName(rawRequestedName, ctx.from.id);

    const result = createBot(botName, senderName);
    if (result === 'FULL') {
        return ctx.reply(`Limite massimo di bot raggiunto (${MAX_CONCURRENT_BOTS}).`);
    }
    if (result === 'DUPLICATE') {
        return ctx.reply(`Il bot "${botName}" è già nel server! Scegli un altro nome.`);
    }
    ctx.reply(`Richiesta accettata! Il bot "${botName}" sta entrando.`);
});

bot.command('esci', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const defaultName = sanitizeMinecraftName(ctx.from.username || ctx.from.first_name, ctx.from.id);
    const botName = args[0] ? sanitizeMinecraftName(args[0], ctx.from.id) : defaultName;

    const botEntry = activeBots.get(botName);
    if (botEntry) {
        botEntry.instance.quit();
        // Niente activeBots.delete qui: lo slot si libera con l'evento 'end'
        addLog(`🚪 Bot "${botName}" fatto uscire da ${ctx.from.first_name || 'un utente'}.`);
        ctx.reply(`Il bot "${botName}" sta uscendo.`);
    } else {
        ctx.reply(`Nessun bot trovato con il nome "${botName}".`);
    }
});

bot.command('sposta', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 4) return ctx.reply('Formato: /sposta <nome> <x> <y> <z>');

    const botName = args[0];
    const x = parseFloat(args[1]), y = parseFloat(args[2]), z = parseFloat(args[3]);

    if (isNaN(x) || isNaN(y) || isNaN(z)) return ctx.reply('Coordinate non valide.');

    const botEntry = activeBots.get(botName);
    if (!botEntry) return ctx.reply(`Bot "${botName}" non trovato.`);

    botEntry.instance.chat(`/tp ${botName} ${x} ${y} ${z}`);
    addLog(`📍 Teletrasportato bot "${botName}" a (${x}, ${y}, ${z}).`);
    ctx.reply(`Bot "${botName}" spostato.`);
});

bot.command('tutti', (ctx) => {
    if (activeBots.size === 0) return ctx.reply('Nessun bot attivo.');
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 3) return ctx.reply('Formato: /tutti <x> <y> <z>');

    const x = parseFloat(args[0]), y = parseFloat(args[1]), z = parseFloat(args[2]);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return ctx.reply('Coordinate non valide.');

    activeBots.forEach((botEntry, name) => {
        botEntry.instance.chat(`/tp ${name} ${x} ${y} ${z}`);
    });

    addLog(`🚀 Teletrasportati TUTTI i ${activeBots.size} bot a (${x}, ${y}, ${z}).`);
    ctx.reply(`Tutti i bot sono stati spostati.`);
});

bot.command('lista', (ctx) => {
    if (activeBots.size === 0) return ctx.reply('Nessun bot attivo.');
    const details = Array.from(activeBots.entries()).map(([n, i]) => `• ${n} (proprietario: ${i.owner})`).join('\n');
    ctx.reply(`Bot attivi:\n${details}`);
});

bot.launch();
console.log("Bot Telegram multi-utente con logging avviato.");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
