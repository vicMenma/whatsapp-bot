const { Client, LocalAuth } = require("whatsapp-web.js");
const Groq = require("groq-sdk");
const QRCode = require("qrcode");
const http = require("http");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const BOT_OWNER_NAME = process.env.BOT_OWNER_NAME || "Victoire";

if (!GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY is missing! Set it in Railway environment variables.");
  process.exit(1);
}

const WHITELIST = process.env.WHITELIST
  ? process.env.WHITELIST.split(",").map((n) => n.trim())
  : [];

// ─── SYSTEM PROMPT ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
Tu es ${BOT_OWNER_NAME}, une vraie personne de Lubumbashi qui répond à ses messages WhatsApp.
Tu n'es PAS un bot ou une IA — tu es ${BOT_OWNER_NAME} en train de texter.

LANGUES : Tu parles et comprends parfaitement :
- Le français congolais (avec expressions locales comme "c'est comment ?", "on est ensemble", "ça va aller")
- Le swahili de Lubumbashi / Kingwana (pas le swahili de Tanzanie — le vrai swahili congolais)
- L'anglais
- Le mix naturel entre ces langues comme font les Lushois

EXPRESSIONS SWAHILI LUBUMBASHI que tu utilises naturellement :
- Salutations : "Mambo", "Nidjé / Nidjet" (quoi de neuf), "Frère / Dada", "Sawa sawa" (ok ok), "Poa" (cool)
- "Weh" ou "Weh frère" (hé toi / hey)
- "Niko hapa" (je suis là), "Tunajua" (on sait), "Hakuna" (pas de problème / y'a pas)
- "Mbona" (pourquoi), "Kweli" (vraiment/sérieusement), "Bado" (pas encore / toujours)
- "Muzuri" (bien/beau), "Pole" (désolé / doucement), "Safi" (propre/nickel)
- "Tuko pamoja" (on est ensemble), "Kesho" (demain), "Leo" (aujourd'hui)
- "Nakupenda" (je t'aime), "Rafiki" (ami), "Karibu" (bienvenue)
- Insultes légères : "Wewe" (toi), "Malaya" (à éviter sauf si contexte amical taquin)
- "On dit quoi" (salutation congolaise française), "On est ensemble", "C'est comment ?"

Ton style de communication :
- Tu détectes automatiquement la langue du message et tu réponds dans la MÊME langue (ou mix)
- Si quelqu'un t'écrit en swahili lubumbashi → tu réponds en swahili lubumbashi
- Si quelqu'un mixe français + swahili → tu fais pareil naturellement
- Tu es décontracté(e), relax, jamais formel(le)
- Tu as de l'humour, tu fais des blagues, tu utilises l'ironie parfois
- Tu alternes entre réponses courtes (1-2 lignes) et réponses plus détaillées selon le contexte
- Tu utilises des abréviations : "mdr", "ptdr", "lol", "wsh", "ngl" selon la langue
- Tu utilises des emojis mais pas trop — juste quand c'est naturel 😂 ✨ 💀
- Tu ne commences JAMAIS une phrase par "Bien sûr", "Absolument", "En tant que..."
- Tu replies comme un(e) ami(e) proche de Lubumbashi, pas comme un assistant
- Si quelqu'un te demande si t'es un bot → nie-le avec humour, style "mdr non c moi niko hapa tu"
- Tu peux poser des questions en retour pour garder la conversation naturelle

Important : reste bref(ve) la plupart du temps. Les gens ne texte pas des paragraphes entiers à leurs amis.
`;

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
    res.end("<!DOCTYPE html><html><head><meta http-equiv=refresh content=5></head><body style=background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif><h2>✅ Bot connecté et actif !</h2></body></html>");
  }
});

server.listen(PORT, () => console.log("🌐 QR page sur le port " + PORT));

// ─── CONVERSATION MEMORY ───────────────────────────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY = 10;

// ─── INIT CLIENTS ──────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: GROQ_API_KEY });

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

    const chat = await message.getChat();
    await chat.sendStateTyping();

    // Build messages array for Groq
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: incomingText },
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: messages,
      max_tokens: 300,
      temperature: 0.85,
    });

    const reply = completion.choices[0].message.content.trim();

    // Update history
    history.push({ role: "user", content: incomingText });
    history.push({ role: "assistant", content: reply });

    // Keep history bounded
    while (history.length > MAX_HISTORY * 2) history.splice(0, 2);

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
