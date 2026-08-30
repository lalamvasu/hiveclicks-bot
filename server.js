/**
 * HiveClicks Chat Assistant — backend
 * ------------------------------------
 * Express server that:
 *  1. Answers visitor questions using Gemini (free tier), grounded in a
 *     system prompt describing HiveClicks' services.
 *  2. Naturally collects name / phone / email / project need over the
 *     conversation, and once all four are present, emails you the lead
 *     and appends a row to a Google Sheet.
 *  3. Tells the frontend when a question couldn't be answered, so the
 *     widget can show the email/call/WhatsApp fallback.
 *
 * See README.md for setup (API keys, Gmail app password, Google Sheet).
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());
app.get("/widget/chatbot-widget.js", (req, res) => {
  res.sendFile(require("path").join(__dirname, "chatbot-widget.js"));
});

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const BUSINESS = {
  name: "HiveClicks",
  email: process.env.CONTACT_EMAIL || "contact@hiveclicks.com", // shown to visitors
  phone: "+91 7337483053",
  whatsapp: "917337483053",
  location: "Visakhapatnam, India",
  services: [
    "SEO & Content — technical SEO, strategic content, technical writing, and Answer Engine Optimization (AEO) for AI-powered search",
    "Social Media Management — content strategy, platform-specific campaigns, LinkedIn and Instagram management",
    "Paid Ads & PPC — Google and Meta ad campaigns focused on traffic, leads, and measurable goals",
    "Web Design & Development — conversion-focused websites, landing pages, WooCommerce, lead-generation tools",
    "Video Editing — short-form video, social content, and ad creatives",
    "AI & Marketing Automation — AI agents, n8n, Make.com workflows, content generation, email automation",
  ],
};

// ---------- in-memory session store (swap for Redis/DB if you expect real scale) ----------
const sessions = new Map(); // sessionId -> { history: [...], lead: {...}, leadSent: bool }

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      history: [],
      lead: { name: null, phone: null, email: null, project: null },
      leadSent: false,
    });
  }
  return sessions.get(id);
}

// ---------- Gemini call ----------
const SYSTEM_PROMPT = `You are Scout, the friendly 24/7 chat assistant on the ${BUSINESS.name} website, a digital marketing agency based in ${BUSINESS.location}. If asked your name, say you're Scout.

SERVICES YOU CAN EXPLAIN:
${BUSINESS.services.map((s) => "- " + s).join("\n")}

YOUR JOB, every turn:
1. Answer the visitor's question if it's about ${BUSINESS.name}'s services, process, or how digital marketing generally works — keep answers short (2-4 sentences), warm, and non-salesy.
2. Naturally, over the course of the conversation (not all at once, not as an interrogation), pick up the visitor's name, phone number, email address, and what they're looking for help with (their "project"). Ask for at most one missing piece per turn, only when it fits naturally — don't block answering their question to ask for it.
3. If the visitor asks something you genuinely don't know (pricing specifics not given here, timelines, technical specifics about their existing site, anything outside these services), say plainly you don't have that detail and that the team will follow up — do NOT make up facts, prices, or promises.
4. Never invent case studies, prices, or guarantees. If unsure, say so.

Respond ONLY with a JSON object matching this shape, no markdown fences, no extra text:
{
  "reply": "the message to show the visitor",
  "unresolved": boolean,   // true if you could not actually answer their question/need and they should be pointed to email/call/WhatsApp
  "lead": {
    "name": string or null,      // fill in only if learned this turn or previously known; otherwise null
    "phone": string or null,
    "email": string or null,
    "project": string or null    // short description of what they want help with
  }
}

Only include a field in "lead" as non-null once the visitor has actually stated it (in this message or earlier in the conversation, which you can see in the history). Never guess or fabricate contact details.`;

async function callGemini(session, userMessage) {
  session.history.push({ role: "user", parts: [{ text: userMessage }] });

  const knownLead = session.lead;
  const contextNote = {
    role: "user",
    parts: [
      {
        text:
          "[context: lead fields already known so far — " +
          JSON.stringify(knownLead) +
          " — carry these forward in your JSON output unless the visitor updates them]",
      },
    ],
  };

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [...session.history.slice(0, -1), contextNote, session.history[session.history.length - 1]],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Gemini API error: " + resp.status + " " + errText);
  }

  const data = await resp.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini returned no content");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Fallback: treat the raw text as a plain reply if it didn't return valid JSON
    parsed = { reply: raw, unresolved: false, lead: knownLead };
  }

  session.history.push({ role: "model", parts: [{ text: raw }] });
  return parsed;
}

// ---------- lead delivery ----------
let mailTransport = null;
function getMailTransport() {
  if (mailTransport) return mailTransport;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  mailTransport = nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return mailTransport;
}

async function sendLeadEmail(lead, pageUrl) {
  const transport = getMailTransport();
  if (!transport) {
    console.warn("SMTP not configured — skipping lead email. See README.md.");
    return;
  }
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.LEAD_NOTIFY_TO || BUSINESS.email, // where YOU receive lead alerts
    subject: `New website lead: ${lead.name || "Unknown"}`,
    text:
      `New lead from the HiveClicks chatbot\n\n` +
      `Name: ${lead.name || "-"}\n` +
      `Phone: ${lead.phone || "-"}\n` +
      `Email: ${lead.email || "-"}\n` +
      `Project: ${lead.project || "-"}\n` +
      `Page: ${pageUrl || "-"}\n` +
      `Time: ${new Date().toISOString()}\n`,
  });
}

async function sendLeadToSheet(lead, pageUrl) {
  const webhook = process.env.SHEET_WEBHOOK_URL;
  if (!webhook) {
    console.warn("SHEET_WEBHOOK_URL not configured — skipping Google Sheet log. See README.md.");
    return;
  }
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      name: lead.name || "",
      phone: lead.phone || "",
      email: lead.email || "",
      project: lead.project || "",
      page: pageUrl || "",
    }),
  });
}

function leadIsComplete(lead) {
  return Boolean(lead.name && lead.phone && lead.email);
}

// ---------- routes ----------
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message, pageUrl } = req.body || {};
    if (!sessionId || !message) {
      return res.status(400).json({ reply: "Missing sessionId or message." });
    }

    const session = getSession(sessionId);
    const result = await callGemini(session, String(message).slice(0, 2000));

    // merge any newly-learned lead fields
    if (result.lead) {
      session.lead.name = result.lead.name ?? session.lead.name;
      session.lead.phone = result.lead.phone ?? session.lead.phone;
      session.lead.email = result.lead.email ?? session.lead.email;
      session.lead.project = result.lead.project ?? session.lead.project;
    }

    if (!session.leadSent && leadIsComplete(session.lead)) {
      session.leadSent = true; // set before awaiting, so we never double-send
      Promise.all([sendLeadEmail(session.lead, pageUrl), sendLeadToSheet(session.lead, pageUrl)]).catch((e) =>
        console.error("Lead delivery failed:", e.message)
      );
    }

    res.json({ reply: result.reply, unresolved: Boolean(result.unresolved) });
  } catch (err) {
    console.error(err);
    res.status(200).json({
      reply: "Sorry, I'm having trouble right now.",
      unresolved: true,
    });
  }
});

app.listen(PORT, () => {
  console.log(`HiveClicks chat backend running on port ${PORT}`);
});
