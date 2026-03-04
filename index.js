const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const Anthropic = require("@anthropic-ai/sdk");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_OWNER_NAME = process.env.BOT_OWNER_NAME || "Victoire";

if (!ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY is missing! Set it in Railway environment variables.");
  process.exit(1);
}

// Contacts whitelist — comma-separated numbers in env var
// e.g. WHITELIST="33612345678,33698765432"
// Leave empty to reply to everyone
const WHITELIST = process.env.WHITELIST
  ? process.env.WHITELIST.split(",").map((n) => n.trim())
  : [];

// ─── SYSTEM PROMPT ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
Tu es ${BOT_OWNER_NAME}, une vraie personne qui répond à ses messages WhatsApp.
Tu n'es PAS un bot ou une IA — tu es ${BOT_OWNER_NAME} en train de texter.

Ton style de communication :
- Tu textes en français ET en anglais selon la langue du message reçu (tu switches naturellement)
- Tu es décontracté(e), relax, jamais formel(le)
- Tu as de l'humour, tu fais des blagues, tu utilises l'ironie parfois
- Tu alternes entre réponses courtes (1-2 lignes) et réponses plus détaillées selon le contexte
- Tu utilises des abréviations naturelles : "mdr", "ptdr", "jsp", "ouais", "wesh", "lol", "omg", "ngl", "tbh"
- Tu utilises des emojis mais pas trop — juste quand c'est naturel 😂 ✨ 💀
- Tu ne commences JAMAIS une phrase par "Bien sûr", "Absolument", "En tant que..."
- Tu replies comme un(e) ami(e) proche, pas comme un assistant
- Si quelqu'un te demande si t'es un bot → nie-le avec humour, style "mdr non c moi j'avais juste pas mon téléphone"
- Tu peux poser des questions en retour pour garder la conversation naturelle
- Garde toujours en tête le contexte de la conversation pour rester cohérent(e)

Important : reste bref(ve) la plupart du temps. Les gens ne texte pas des paragraphes entiers à leurs amis.
`;

// ─── CONVERSATION MEMORY ───────────────────────────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY = 10;

// ─── INIT CLIENTS ──────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./.wwebjs_auth" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
});

// ─── QR CODE ───────────────────────────────────────────────────────────────
client.on("qr", (qr) => {
  console.log("\n📱 Scanne ce QR code avec WhatsApp (Appareils liés) :\n");
  qrcode.generate(qr, { small: true });
  console.log("\n⚠️  QR visible dans Railway Logs → ouvre les logs pour scanner !\n");
});

// ─── READY ─────────────────────────────────────────────────────────────────
client.on("ready", () => {
  console.log("\n✅ Bot WhatsApp connecté et prêt !");
  console.log(`🤖 Répond comme : ${BOT_OWNER_NAME}`);
  console.log(
    WHITELIST.length > 0
      ? `📋 Whitelist active : ${WHITELIST.length} contact(s)`
      : "📋 Répond à tous les contacts"
  );
  console.log("─".repeat(40));
});

// ─── MESSAGE HANDLER ───────────────────────────────────────────────────────
client.on("message", async (message) => {
  try {
    if (message.fromMe) return;
    if (message.isStatus) return;

    const sender = message.from;
    const senderNumber = sender.replace("@c.us", "").replace("@g.us", "");
    const isGroup = sender.includes("@g.us");

    if (isGroup) return;

    if (WHITELIST.length > 0 && !WHITELIST.includes(senderNumber)) {
      console.log(`⏭️  Ignored (not in whitelist): ${senderNumber}`);
      return;
    }

    if (!message.body || message.body.trim() === "") return;

    const incomingText = message.body.trim();
    console.log(`\n📨 [${senderNumber}]: ${incomingText}`);

    if (!conversationHistory.has(sender)) {
      conversationHistory.set(sender, []);
    }
    const history = conversationHistory.get(sender);

    history.push({ role: "user", content: incomingText });
    while (history.length > MAX_HISTORY) history.shift();

    const chat = await message.getChat();
    await chat.sendStateTyping();

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    history.push({ role: "assistant", content: reply });

    const delay = 1000 + Math.random() * 2000;
    await new Promise((res) => setTimeout(res, delay));

    await message.reply(reply);
    console.log(`✅ Replied: ${reply}`);
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
console.log("🚀 Démarrage du bot WhatsApp...");
client.initialize();
