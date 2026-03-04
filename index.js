const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const http = require("http");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BOT_OWNER_NAME = process.env.BOT_OWNER_NAME || "Victoire";
const EMERGENCY_NUMBER = process.env.EMERGENCY_NUMBER || "+260969370276";

// Cooldown: don't reply to same person more than once every X minutes
const COOLDOWN_SECONDS = process.env.COOLDOWN_SECONDS ? parseInt(process.env.COOLDOWN_SECONDS) : 5;

// ─── AUTO REPLY MESSAGES ───────────────────────────────────────────────────
const OFFLINE_FR = `Salut ! 😊 ${BOT_OWNER_NAME} n'est pas disponible pour le moment.

Tu peux lui laisser un message ici, il te répondra dès qu'il sera de retour. 📩

🚨 En cas d'urgence, appelle directement au : *${EMERGENCY_NUMBER}*`;

const OFFLINE_EN = `Hey! 😊 ${BOT_OWNER_NAME} is not available right now.

Feel free to leave a message here, he'll get back to you as soon as he's back. 📩

🚨 For emergencies, call directly: *${EMERGENCY_NUMBER}*`;

// Basic language detection
function detectLanguage(text) {
  const frWords = /\b(je|tu|il|elle|nous|vous|salut|bonjour|merci|comment|quoi|oui|non|pour|avec|dans|sur|pas|plus|tres|bien|stp|svp|sais|vais|suis|fait|avoir|être|aller|voir|venir|dire|faire)\b/i;
  return frWords.test(text) ? "fr" : "en";
}

function getOfflineMessage(text) {
  return detectLanguage(text) === "fr" ? OFFLINE_FR : OFFLINE_EN;
}

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

// ─── OFFLINE SWITCH ────────────────────────────────────────────────────────
let isOffline = false; // Bot starts in ONLINE mode (not replying)

// ─── COOLDOWN TRACKER ──────────────────────────────────────────────────────
const lastReplied = new Map();

function canReply(sender) {
  const now = Date.now();
  const last = lastReplied.get(sender);
  if (!last) return true;
  return now - last > COOLDOWN_SECONDS * 1000;
}

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

// ─── QR CODE ───────────────────────────────────────────────────────────────
client.on("qr", (qr) => {
  currentQR = qr;
  console.log("📱 Nouveau QR code généré — ouvre le lien Railway pour scanner !");
});

// ─── READY ─────────────────────────────────────────────────────────────────
client.on("ready", () => {
  currentQR = null;
  console.log("\n✅ Bot connecté !");
  console.log(`📴 Auto-reply actif pour : ${BOT_OWNER_NAME}`);
  console.log(`🚨 Numéro d'urgence : ${EMERGENCY_NUMBER}`);
  console.log(`⏱️  Cooldown : ${COOLDOWN_SECONDS} secondes par contact`);
  console.log("─".repeat(40));
});

// ─── MESSAGE HANDLER ───────────────────────────────────────────────────────
client.on("message", async (message) => {
  try {
    if (message.isStatus) return;

    // Detect all media types
    const typeMap = {
      "ptt": "🎤 vocal",
      "audio": "🎵 audio",
      "image": "🖼️ photo",
      "video": "🎥 vidéo",
      "sticker": "🎭 sticker",
      "gif": "🎞️ gif",
      "document": "📄 document",
      "location": "📍 localisation",
      "contact": "👤 contact",
    };
    const isMedia = message.type in typeMap;
    const mediaLabel = typeMap[message.type] || message.type;

    const sender = message.from;
    const isGroup = sender.includes("@g.us");
    if (isGroup) return;

    const senderNumber = sender.replace("@c.us", "");
    const text = (message.body || "").trim().toLowerCase();

    // ── Commands from yourself ──────────────────────────────────────────
    if (message.fromMe) {
      const respond = async (msg) => {
        try {
          // Try replying directly to the message
          await message.reply(msg);
        } catch {
          try {
            // Fallback: send to the chat
            const chat = await message.getChat();
            await chat.sendMessage(msg);
          } catch (e) {
            console.log("📣 " + msg); // Last resort: just log it
          }
        }
      };

      if (text === "!offline") {
        isOffline = true;
        lastReplied.clear();
        console.log("📴 Mode OFFLINE activé");
        await respond("📴 *Mode hors ligne activé*\nJe réponds automatiquement à tous tes messages.\n\nTape *!online* pour désactiver.");
      } else if (text === "!online") {
        isOffline = false;
        console.log("✅ Mode ONLINE activé");
        await respond("✅ *Mode en ligne activé*\nJe ne réponds plus automatiquement.\n\nTape *!offline* pour réactiver.");
      } else if (text === "!status") {
        const status = isOffline
          ? "📴 *Statut : Hors ligne*\nLe bot répond automatiquement aux messages."
          : "✅ *Statut : En ligne*\nLe bot ne répond pas automatiquement.";
        await respond(status + "\n\n*Commandes :*\n!offline — activer\n!online — désactiver\n!status — voir le statut");
      }
      return;
    }

    // ── Auto-reply only when offline ────────────────────────────────────
    if (!isOffline) return;

    console.log(`\n📨 [${senderNumber}]: ${isMedia ? mediaLabel : message.body}`);

    if (!canReply(sender)) {
      console.log(`⏭️  Cooldown actif pour ${senderNumber}, pas de réponse`);
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

// ─── DISCONNECTED ──────────────────────────────────────────────────────────
client.on("disconnected", (reason) => {
  console.log("⚠️  Bot disconnected:", reason);
  setTimeout(() => {
    console.log("🔄 Reconnecting...");
    client.initialize();
  }, 5000);
});

// ─── START ─────────────────────────────────────────────────────────────────
console.log("🚀 Démarrage du bot...");
client.initialize();
