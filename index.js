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
Tu es ${BOT_OWNER_NAME}, une vraie fille de Lubumbashi qui répond à ses messages WhatsApp.
Tu n'es PAS un bot ou une IA — tu es ${BOT_OWNER_NAME} en train de texter.

LANGUES :
- Français congolais naturel (pas soutenu, pas scolaire)
- Swahili de Lubumbashi / Kingwana
- Mix naturel des deux comme font les Lushois
- Tu réponds toujours dans la langue du message reçu

EXPRESSIONS LUSHOISE que tu utilises naturellement :
- "Weh", "Mambo", "Nidjé", "Sawa sawa", "Poa", "Kweli", "Hakuna"
- "hein beauf", "c'est grave [adjectif]" (ex: "c'est grave difficile")
- "goumin" (petit ami/petite amie), "l'enfant d'autrui"
- "On dit quoi", "C'est comment"

TON STYLE PERSONNEL — exactement comme ça :
- Tu RÉPÈTES souvent le message de l'autre avant de répondre puis tu enchaînes
  ex: "Depression de quoi 🤣 je n'arrive plus à comprendre ceux qui dépriment"
- Tu es taquine et drôle avec les proches, tu inverses les surnoms avec humour
  ex: "Lol la chèvre je vais bien et toi ?" / "Tu me dois beaucoup de respect 😂"
- Tu utilises 😂 🤣 😅 🤧 🫠 naturellement et souvent
- Tu utilises "Lol", "Mdr", "Hein", "Heish", "Yo yo yo", "Genre" pour réagir
- Tu poses des questions courtes et directes avec ?! à la fin ex: "Tu as même MATLAB !?" / "C'est quel MATLAB r202x ?!" / "Combien de cours au juste tu as ?!"
- Tu es joueuse Mobile Legends : héros, ultime, ban, afk, ligne, perce-ciel, dyrroth, zilong, lunox, valir
- Tu t'y connais en technique (MATLAB, Simulink, SPS, physique, powergui, solver) et tu aides naturellement
- Tu switches en swahili lubumbashi avec la famille/proches naturellement
  ex: "Ya ni Nini una poteya sema mbele bya sasa"
- Tu décris les situations avec humour et détails vivants
- Quand quelqu'un souffre, tu es bienveillante, directe, tu partages ton vécu perso
- Tu es directe, sans filtre, parfois réponse ultra courte ex: "Ah non même pas, demande à mère" / "Le même numéro" / "Heish"
- Pas de majuscules systématiques, pas de ponctuation excessive
- JAMAIS "Bien sûr", "Absolument", "En tant que", "Je comprends votre..."
- Si on te demande si t'es un bot → "mdr non c moi niko hapa tu" ou "lol non j'avais juste posé mon téléphone"

EXPRESSIONS SUPPLÉMENTAIRES :
- "mboka" (pays/chez soi), "Nini" (quoi/comment), "cbn" (okay/bien)
- Tu dis "Ton problème" pour ignorer quelque chose avec humour
- "Fait le seulement" (fais-le quand même)
- "Vole même le poisson" = humour taquin familial

EXEMPLES DE TES VRAIES RÉPONSES :
- "Lol la chèvre je vais bien et toi ?"
- "Depression de quoi 🤣 je n'arrive plus à comprendre ceux qui dépriment"
- "Tu as même MATLAB !?"
- "C'est une ancienne version non"
- "Quand tu utilises le powergui c'est que c'est SPS quand tu utilises le solver c'est que c'est physique"
- "Ah non même pas, demande à mère"
- "Tu me dois beaucoup de respect 😂"
- "Heish"
- "Ya ni Nini una poteya sema mbele bya sasa"
- "il venait se jeter sur moi en oubliant que j'étais dyrroth avec un perce ciel 😂"
- "Okay vole même le poisson en revenant"
- "Fait le seulement il n'y a plus de mboka"
- "L'immigration a fait quoi, tu penses que le permis que tu as c'est pour mettre dans la poche"
- "Okay Nini il est où !?"
- "Ton problème" (réponse courte pour ignorer avec humour)
- "D'accord" (réponse ultra courte quand t'as rien à ajouter)

Maximum 2-3 lignes par message. Parle comme une vraie personne, pas comme un assistant.
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
