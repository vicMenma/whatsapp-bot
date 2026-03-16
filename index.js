const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const http = require("http");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BOT_OWNER_NAME = process.env.BOT_OWNER_NAME || "Victoire";
const EMERGENCY_NUMBER = process.env.EMERGENCY_NUMBER || "+260969370276";
const COOLDOWN_SECONDS = process.env.COOLDOWN_SECONDS ? parseInt(process.env.COOLDOWN_SECONDS) : 5;

const AUTO_OFFLINE_START = process.env.AUTO_OFFLINE_START ? parseInt(process.env.AUTO_OFFLINE_START) : 23;
const AUTO_OFFLINE_END = process.env.AUTO_OFFLINE_END ? parseInt(process.env.AUTO_OFFLINE_END) : 7;

const BLACKLIST = process.env.BLACKLIST
  ? process.env.BLACKLIST.split(",").map((n) => n.trim())
  : [];

// ─── STATE ─────────────────────────────────────────────────────────────────
let isOffline = false;
let autoScheduleEnabled = false;
const lastReplied = new Map();
const missedMessages = [];
const scheduledMessages = []; // { id, to, message, time }
let scheduleIdCounter = 1;

// ─── LANGUAGE DETECTION ────────────────────────────────────────────────────
function detectLanguage(text) {
  const swWords = /\b(mambo|nidje|nidjet|weh|sawa|poa|hakuna|kweli|bado|muzuri|pole|safi|niko|hapa|rafiki|karibu|kesho|leo|mbona|nakupenda|asante|ndio|hapana|mimi|wewe|sisi|ninyi|wao|kitu|nini|una|poteya|sema|mbele|chaud|mubaya|heish)\b/i;
  const frWords = /\b(je|tu|il|elle|nous|vous|salut|bonjour|merci|comment|quoi|oui|non|pour|avec|dans|sur|pas|plus|bien|stp|svp|suis|fait|avoir|aller|voir|venir|dire|faire|mdr|lol)\b/i;
  if (swWords.test(text)) return "sw";
  if (frWords.test(text)) return "fr";
  return "en";
}

function getOfflineMessage(text) {
  const lang = detectLanguage(text);
  if (lang === "sw") return `Mambo! 😊 ${BOT_OWNER_NAME} yuko nje sasa hivi.\n\nAcha ujumbe hapa, atajibu haraka atakapokuwa. 📩\n\n🚨 Kama ni dharura, piga simu moja kwa moja: *${EMERGENCY_NUMBER}*`;
  if (lang === "fr") return `Salut ! 😊 ${BOT_OWNER_NAME} n'est pas disponible pour le moment.\n\nTu peux lui laisser un message ici, il te répondra dès qu'il sera de retour. 📩\n\n🚨 En cas d'urgence, appelle directement au : *${EMERGENCY_NUMBER}*`;
  return `Hey! 😊 ${BOT_OWNER_NAME} is not available right now.\n\nFeel free to leave a message here, he'll get back to you as soon as he's back. 📩\n\n🚨 For emergencies, call directly: *${EMERGENCY_NUMBER}*`;
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function canReply(sender) {
  const now = Date.now();
  const last = lastReplied.get(sender);
  if (!last) return true;
  return now - last > COOLDOWN_SECONDS * 1000;
}

function isAutoOfflineHour() {
  const hour = new Date().getHours();
  if (AUTO_OFFLINE_START > AUTO_OFFLINE_END) {
    return hour >= AUTO_OFFLINE_START || hour < AUTO_OFFLINE_END;
  }
  return hour >= AUTO_OFFLINE_START && hour < AUTO_OFFLINE_END;
}

function formatTime(date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// ─── NORMALIZE NUMBER → WhatsApp ID ────────────────────────────────────────
function toWAId(raw) {
  // Strip everything except digits
  const digits = raw.replace(/\D/g, "");
  return digits + "@c.us";
}

// ─── AUTO SCHEDULE CHECKER ─────────────────────────────────────────────────
setInterval(() => {
  if (!autoScheduleEnabled) return;
  const shouldBeOffline = isAutoOfflineHour();
  if (shouldBeOffline && !isOffline) {
    isOffline = true;
    console.log("⏰ Auto-schedule: Mode OFFLINE activé");
  } else if (!shouldBeOffline && isOffline) {
    isOffline = false;
    console.log("⏰ Auto-schedule: Mode ONLINE activé");
  }
}, 60 * 1000);

// ─── SCHEDULED MESSAGES CHECKER ────────────────────────────────────────────
setInterval(async () => {
  const now = Date.now();
  if (scheduledMessages.length > 0) {
    console.log(`⏱ ${scheduledMessages.length} message(s) en attente...`);
  }

  // Collect due messages in order (first scheduled = first sent)
  const due = scheduledMessages.filter(m => now >= m.time);
  due.sort((a, b) => a.id - b.id); // lowest ID = programmed first

  for (const msg of due) {
    console.log(`📤 Envoi du message #${msg.id} à ${msg.to}...`);
    try {
      const isRegistered = await client.isRegisteredUser(msg.to);
      if (!isRegistered) {
        console.error(`❌ Numéro non enregistré sur WhatsApp: ${msg.to}`);
      } else {
        await client.sendMessage(msg.to, msg.message);
        console.log(`✅ Message #${msg.id} envoyé avec succès à ${msg.to}`);
      }
    } catch (e) {
      console.error(`❌ Échec envoi message #${msg.id} à ${msg.to}: ${e.message}`);
    }
    // Remove from array regardless of success
    const idx = scheduledMessages.findIndex(m => m.id === msg.id);
    if (idx > -1) scheduledMessages.splice(idx, 1);
  }
}, 10 * 1000);

// ─── QR WEB SERVER ─────────────────────────────────────────────────────────
let currentQR = null;
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  if (currentQR) {
    const qrImage = await QRCode.toDataURL(currentQR, { width: 300 });
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head><title>WhatsApp Bot QR</title><meta http-equiv="refresh" content="30"><style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff}img{border-radius:16px;border:4px solid #25D366}p{color:#aaa;font-size:14px;margin-top:16px}</style></head><body><h2>📱 Scanne avec WhatsApp</h2><img src="${qrImage}"/><p>Page rafraîchie toutes les 30s</p></body></html>`);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="5"><style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff}</style></head><body><h2>✅ Bot connecté et actif !</h2></body></html>`);
  }
});

server.listen(PORT, () => console.log("🌐 QR page sur le port " + PORT));

// ─── WHATSAPP CLIENT ───────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./.wwebjs_auth" }),
  puppeteer: {
    headless: true,
    protocolTimeout: 60000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--single-process",
    ],
  },
});

client.on("qr", (qr) => {
  currentQR = qr;
  console.log("📱 Nouveau QR code généré — ouvre le lien Railway pour scanner !");
});

client.on("ready", () => {
  currentQR = null;
  console.log("\n✅ Bot connecté !");
  console.log(`👤 Propriétaire : ${BOT_OWNER_NAME}`);
  console.log(`🚨 Urgence : ${EMERGENCY_NUMBER}`);
  console.log(`⏱️  Cooldown : ${COOLDOWN_SECONDS}s`);
  console.log(`🔕 Blacklist : ${BLACKLIST.length} contact(s)`);
  console.log("─".repeat(40));
  console.log("📋 Commandes: !offline !online !status !missed !stats !schedule !blacklist !help");
  console.log("─".repeat(40));
});

// ─── MESSAGE HANDLER ───────────────────────────────────────────────────────
client.on("message_create", async (message) => {
  try {
    if (message.isStatus) return;

    const sender = message.from;
    const isGroup = sender.includes("@g.us");
    if (isGroup) return;

    const senderNumber = sender.replace("@c.us", "");
    const text = (message.body || "").trim().toLowerCase();

    const typeMap = {
      "ptt": "🎤 vocal", "audio": "🎵 audio", "image": "🖼️ photo",
      "video": "🎥 vidéo", "sticker": "🎭 sticker", "gif": "🎞️ gif",
      "document": "📄 document", "location": "📍 localisation", "contact": "👤 contact",
    };
    const isMedia = message.type in typeMap;

    // ── Commands from yourself ──────────────────────────────────────────
    if (message.fromMe) {
      const respond = async (msg) => {
        try { await message.reply(msg); }
        catch { try { const chat = await message.getChat(); await chat.sendMessage(msg); }
        catch (e) { console.log("📣 " + msg); } }
      };

      // !help
      if (text === "!help") {
        await respond(
          `🤖 *Commandes disponibles :*\n\n` +
          `*!offline* — activer l'auto-reply\n` +
          `*!online* — désactiver l'auto-reply\n` +
          `*!status* — voir l'état actuel\n` +
          `*!missed* — voir les messages manqués\n` +
          `*!stats* — statistiques des messages\n` +
          `*!auto on/off* — horaires automatiques (${AUTO_OFFLINE_START}h-${AUTO_OFFLINE_END}h)\n` +
          `*!blacklist add/remove/list +260xxx* — gérer la blacklist\n` +
          `*!schedule +260xxx HH:MM message* — programmer un message\n` +
          `*!schedule list* — voir les messages programmés\n` +
          `*!schedule cancel ID* — annuler un message programmé`
        );

      // !offline
      } else if (text === "!offline") {
        isOffline = true;
        lastReplied.clear();
        console.log("📴 Mode OFFLINE activé");
        await respond(`📴 *Mode hors ligne activé*\nJe réponds automatiquement à tous tes messages.\n\nTape *!online* pour désactiver.`);

      // !online
      } else if (text === "!online") {
        isOffline = false;
        console.log("✅ Mode ONLINE activé");
        await respond(`✅ *Mode en ligne activé*\nJe ne réponds plus automatiquement.\n\nTape *!offline* pour réactiver.`);

      // !status
      } else if (text === "!status") {
        const state = isOffline ? "📴 Hors ligne" : "✅ En ligne";
        const auto = autoScheduleEnabled ? `✅ Actif (${AUTO_OFFLINE_START}h → ${AUTO_OFFLINE_END}h)` : "❌ Inactif";
        await respond(
          `${state}\n\n` +
          `⏰ *Horaire auto :* ${auto}\n` +
          `🔕 *Blacklist :* ${BLACKLIST.length} contact(s)\n` +
          `📨 *Messages manqués :* ${missedMessages.length}\n` +
          `📅 *Messages programmés :* ${scheduledMessages.length}\n\n` +
          `Tape *!help* pour voir toutes les commandes.`
        );

      // !missed
      } else if (text === "!missed") {
        if (missedMessages.length === 0) {
          await respond("📭 Aucun message manqué pour le moment.");
        } else {
          let list = `📬 *${missedMessages.length} message(s) manqué(s) :*\n\n`;
          missedMessages.forEach((m, i) => {
            list += `${i + 1}. *${m.number}* à ${m.time}\n    "${m.preview}"\n\n`;
          });
          await respond(list);
        }

      // !stats
      } else if (text === "!stats") {
        if (missedMessages.length === 0) {
          await respond("📊 Aucune statistique disponible pour le moment.");
        } else {
          const counts = {};
          missedMessages.forEach((m) => {
            counts[m.number] = (counts[m.number] || 0) + 1;
          });
          const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          let stats = `📊 *Statistiques :*\n\n`;
          sorted.forEach(([num, count]) => {
            stats += `• *${num}* : ${count} message(s)\n`;
          });
          stats += `\n*Total :* ${missedMessages.length} messages`;
          await respond(stats);
        }

      // !auto on/off
      } else if (text === "!auto on") {
        autoScheduleEnabled = true;
        await respond(`⏰ *Horaire automatique activé*\nLe bot s'activera automatiquement de *${AUTO_OFFLINE_START}h* à *${AUTO_OFFLINE_END}h*.\n\nTape *!auto off* pour désactiver.`);
      } else if (text === "!auto off") {
        autoScheduleEnabled = false;
        await respond(`⏰ *Horaire automatique désactivé*\nGère manuellement avec *!offline* et *!online*.`);

      // !blacklist
      } else if (text.startsWith("!blacklist")) {
        const parts = text.split(" ");
        const action = parts[1];
        const number = parts[2] ? parts[2].replace("+", "") : null;

        if (action === "list") {
          await respond(BLACKLIST.length === 0
            ? "🔕 Blacklist vide."
            : `🔕 *Blacklist :*\n${BLACKLIST.map(n => `• +${n}`).join("\n")}`
          );
        } else if (action === "add" && number) {
          if (!BLACKLIST.includes(number)) BLACKLIST.push(number);
          await respond(`🔕 *+${number}* ajouté à la blacklist.`);
        } else if (action === "remove" && number) {
          const idx = BLACKLIST.indexOf(number);
          if (idx > -1) BLACKLIST.splice(idx, 1);
          await respond(`✅ *+${number}* retiré de la blacklist.`);
        } else {
          await respond(`🔕 *Blacklist :*\n!blacklist list\n!blacklist add +260xxx\n!blacklist remove +260xxx`);
        }

      // ── !schedule ──────────────────────────────────────────────────────
      } else if (text.startsWith("!schedule")) {
        const rawBody = message.body.trim();
        const parts = rawBody.split(" ");
        const subCommand = parts[1] ? parts[1].toLowerCase() : "";

        // !schedule list
        if (subCommand === "list") {
          if (scheduledMessages.length === 0) {
            await respond("📅 Aucun message programmé.");
          } else {
            let list = `📅 *${scheduledMessages.length} message(s) programmé(s) :*\n\n`;
            scheduledMessages.forEach((m) => {
              const t = new Date(m.time);
              list += `*#${m.id}* → +${m.to.replace("@c.us", "")} à ${formatTime(t)}\n"${m.message}"\n\n`;
            });
            await respond(list);
          }

        // !schedule cancel <id>
        } else if (subCommand === "cancel") {
          const id = parseInt(parts[2]);
          const idx = scheduledMessages.findIndex((m) => m.id === id);
          if (idx > -1) {
            scheduledMessages.splice(idx, 1);
            await respond(`✅ Message *#${id}* annulé.`);
          } else {
            await respond(`❌ Aucun message avec l'ID *#${id}* trouvé.`);
          }

        // !schedule +260xxx HH:MM message text
        } else if (parts.length >= 4) {
          const rawNumber = parts[1]; // e.g. +260969370276
          const timeStr = parts[2];   // e.g. 22:23
          const msgText = parts.slice(3).join(" ");

          // Validate time format
          const timeParts = timeStr.split(":");
          const scheduledHour = parseInt(timeParts[0]);
          const scheduledMin = parseInt(timeParts[1]);

          if (
            isNaN(scheduledHour) || isNaN(scheduledMin) ||
            scheduledHour < 0 || scheduledHour > 23 ||
            scheduledMin < 0 || scheduledMin > 59
          ) {
            await respond(`❌ Heure invalide: *${timeStr}*\nFormat attendu: *HH:MM* (ex: 14:30)`);
            return;
          }

          if (!msgText) {
            await respond(`❌ Message vide. Usage:\n!schedule +260xxx HH:MM Ton message ici`);
            return;
          }

          // Build WhatsApp ID from number
          const waId = toWAId(rawNumber);

          // Calculate scheduled time
          const now = new Date();
          const scheduled = new Date();
          scheduled.setHours(scheduledHour, scheduledMin, 0, 0);

          // If time already passed today, schedule for tomorrow
          if (scheduled.getTime() <= now.getTime()) {
            scheduled.setDate(scheduled.getDate() + 1);
          }

          const minutesUntil = Math.round((scheduled.getTime() - now.getTime()) / 60000);
          const id = scheduleIdCounter++;

          scheduledMessages.push({
            id,
            to: waId,
            message: msgText,
            time: scheduled.getTime(),
          });

          console.log(`📅 Message #${id} programmé pour ${waId} à ${scheduled.toLocaleTimeString()} (dans ${minutesUntil} min)`);

          await respond(
            `✅ *Message programmé ! (#${id})*\n\n` +
            `📱 À : *${rawNumber}*\n` +
            `🕐 Heure : *${timeStr}*\n` +
            `⏳ Dans : *${minutesUntil} minute(s)*\n` +
            `💬 Message : "${msgText}"\n\n` +
            `Tape *!schedule list* pour voir tous les messages programmés.\n` +
            `Tape *!schedule cancel ${id}* pour annuler.`
          );

        } else {
          await respond(
            `📅 *Commandes schedule :*\n\n` +
            `*!schedule +260xxx HH:MM message* — programmer\n` +
            `*!schedule list* — voir la liste\n` +
            `*!schedule cancel ID* — annuler`
          );
        }
      }

      return;
    }

    // ── Incoming messages ───────────────────────────────────────────────
    if (BLACKLIST.includes(senderNumber)) {
      console.log(`🔕 Blacklisté, ignoré : ${senderNumber}`);
      return;
    }

    const contact = await message.getContact();
    const contactName = contact.pushname || contact.name || senderNumber;
    const preview = isMedia ? `[${typeMap[message.type]}]` : (message.body || "").substring(0, 50);
    missedMessages.push({
      number: senderNumber,
      name: contactName,
      time: formatTime(new Date()),
      preview,
    });
    if (missedMessages.length > 100) missedMessages.shift();

    console.log(`\n📨 [${senderNumber}] ${contactName}: ${preview}`);

    if (!isOffline) return;

    if (!canReply(sender)) {
      console.log(`⏭️  Cooldown actif pour ${senderNumber}`);
      return;
    }

    await new Promise((res) => setTimeout(res, 2000));
    const msgText = isMedia ? "" : (message.body || "");
    await message.reply(getOfflineMessage(msgText));
    lastReplied.set(sender, Date.now());
    console.log(`✅ Auto-reply envoyé à ${senderNumber}`);

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
});

client.on("disconnected", (reason) => {
  console.log("⚠️  Bot disconnected:", reason);
  setTimeout(() => { console.log("🔄 Reconnecting..."); client.initialize(); }, 5000);
});

console.log("🚀 Démarrage du bot...");
client.initialize();
