/**
 * HiveClicks Chat Assistant — backend
 * ------------------------------------
 * Express server that:
 *  1. Walks every visitor through a fixed sequence: name -> email -> phone
 *     -> business name -> service needed. No AI involved in this part, so
 *     it's fast and can't go out of order.
 *  2. Once that's done, opens up to free-form Q&A about HiveClicks'
 *     services, answered by Groq (free, fast, Llama-based).
 *  3. Pushes the completed lead to your Google Sheet as soon as it's
 *     collected, and emails you the FULL conversation transcript once the
 *     visitor closes the chat (or leaves the page).
 *
 * See README.md for setup (API keys, Gmail app password, Google Sheet).
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.get("/widget/chatbot-widget.js", (req, res) => {
  res.sendFile(path.join(__dirname, "chatbot-widget.js"));
});

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const BUSINESS = {
  name: "HiveClicks",
  email: process.env.CONTACT_EMAIL || "contact@hiveclicks.com",
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

const sessions = new Map();

const STAGE_PROMPTS = {
  name: "Nice to meet you! What's the best email to reach you at?",
  email: "Great, thank you. And a phone number where our team can reach you?",
  phone: "Got it. What's your business or company name?",
  business:
    "And what are you looking for help with — SEO, ads, website, social media, video, or automation?",
};

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      stage: "name",
      lead: { name: null, email: null, phone: null, business: null, project: null },
      transcript: [],
      sheetSent: false,
      transcriptSent: false,
    });
  }
  return sessions.get(id);
}

const QA_SYSTEM_PROMPT = `You are Scout, the friendly 24/7 chat assistant on the ${BUSINESS.name} website, a digital marketing agency based in ${BUSINESS.location}. If asked your name, say you're Scout.

SERVICES YOU CAN EXPLAIN:
${BUSINESS.services.map((s) => "- " + s).join("\n")}

The visitor has already given their contact details, so your only job now is to answer their questions about ${BUSINESS.name}'s services, process, or digital marketing in general — keep answers short (2-4 sentences), warm, and non-salesy.

If the visitor asks something you genuinely don't know (pricing specifics not given here, timelines, technical specifics about their existing site, anything outside these services), say plainly you don't have that detail and that the team will follow up — do NOT make up facts, prices, or promises. Never invent case studies, prices, or guarantees.

Respond ONLY with a JSON object, no markdown fences, no extra text:
{ "reply": "the message to show the visitor", "unresolved": boolean }`;

async function callGroq(session, userMessage) {
  const messages = [
    { role: "system", content: QA_SYSTEM_PROMPT },
    ...session.transcript
      .filter((t) => t.stage === "qa")
      .slice(-16)
      .map((t) => ({ role: t.role === "bot" ? "assistant" : "user", content: t.text })),
    { role: "user", content: userMessage },
  ];

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Groq API error: " + resp.status + " " + errText);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Groq returned no content");

  try {
    return JSON.parse(raw);
  } catch (e) {
    return { reply: raw, unresolved: false };
  }
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
      business: lead.business || "",
      phone: lead.phone || "",
      email: lead.email || "",
      project: lead.project || "",
      page: pageUrl || "",
    }),
  });
}

async function sendTranscriptEmail(session, pageUrl) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not configured — skipping transcript email. See README.md.");
    return;
  }
  const { lead, transcript } = session;
  const transcriptText = transcript.map((t) => `${t.role === "user" ? "Visitor" : "Scout"}: ${t.text}`).join("\n");
  const to = process.env.LEAD_NOTIFY_TO || BUSINESS.email;

  console.log(`[end-session] Sending transcript email to ${to} via Resend...`);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "HiveClicks Bot <onboarding@resend.dev>",
      to: [to],
      subject: `Chat transcript: ${lead.name || "Unknown visitor"}`,
      text:
        `Full chat transcript from the HiveClicks chatbot\n\n` +
        `Name: ${lead.name || "-"}\n` +
        `Business: ${lead.business || "-"}\n` +
        `Phone: ${lead.phone || "-"}\n` +
        `Email: ${lead.email || "-"}\n` +
        `Project: ${lead.project || "-"}\n` +
        `Page: ${pageUrl || "-"}\n\n` +
        `--- Conversation ---\n${transcriptText}\n`,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Resend API error: " + resp.status + " " + errText);
  }
  console.log("[end-session] Transcript email sent successfully via Resend.");
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message, pageUrl } = req.body || {};
    if (!sessionId || !message) {
      return res.status(400).json({ reply: "Missing sessionId or message." });
    }
    const text = String(message).slice(0, 2000).trim();
    const session = getSession(sessionId);
    session.transcriptSent = false; // new activity — any future end-of-session should send an updated transcript
    session.transcript.push({ role: "user", text, stage: session.stage });

    let replyText;
    let unresolved = false;

    if (session.stage === "name") {
      session.lead.name = text;
      replyText = `Nice to meet you, ${text}! ${STAGE_PROMPTS.name}`;
      session.stage = "email";
    } else if (session.stage === "email") {
      session.lead.email = text;
      replyText = STAGE_PROMPTS.email;
      session.stage = "phone";
    } else if (session.stage === "phone") {
      session.lead.phone = text;
      replyText = STAGE_PROMPTS.phone;
      session.stage = "business";
    } else if (session.stage === "business") {
      session.lead.business = text;
      replyText = STAGE_PROMPTS.business;
      session.stage = "service";
    } else if (session.stage === "service") {
      session.lead.project = text;
      replyText = `Thanks, ${session.lead.name || "there"}! I've passed your details to our team and someone will reach out soon. In the meantime, feel free to ask me anything about our services — or just close this chat whenever you're done.`;
      session.stage = "qa";

      if (!session.sheetSent) {
        session.sheetSent = true;
        sendLeadToSheet(session.lead, pageUrl).catch((e) => console.error("Sheet push failed:", e.message));
      }
    } else {
      const result = await callGroq(session, text);
      replyText = result.reply;
      unresolved = Boolean(result.unresolved);
    }

    session.transcript.push({ role: "bot", text: replyText, stage: session.stage });
    res.json({ reply: replyText, unresolved });
  } catch (err) {
    console.error(err);
    res.status(200).json({
      reply: "Sorry, I'm having trouble right now.",
      unresolved: true,
    });
  }
});

app.post("/api/end-session", async (req, res) => {
  try {
    const { sessionId, pageUrl } = req.body || {};
    console.log(`[end-session] Hit for sessionId=${sessionId}`);
    if (!sessionId || !sessions.has(sessionId)) {
      console.log("[end-session] No matching session found — nothing to send.");
      return res.status(200).json({ ok: true });
    }
    const session = sessions.get(sessionId);
    console.log(`[end-session] transcript length=${session.transcript.length}, transcriptSent=${session.transcriptSent}`);
    if (session.transcript.length === 0 || session.transcriptSent) {
      return res.status(200).json({ ok: true });
    }
    session.transcriptSent = true;
    await sendTranscriptEmail(session, pageUrl);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[end-session] error:", err.message);
    res.status(200).json({ ok: true });
  }
});

app.listen(PORT, () => {
  console.log(`HiveClicks chat backend running on port ${PORT}`);
  console.log(`RESEND_API_KEY configured: ${Boolean(process.env.RESEND_API_KEY)}`);
  console.log(`SHEET_WEBHOOK_URL configured: ${Boolean(process.env.SHEET_WEBHOOK_URL)}`);
  console.log(`GROQ_API_KEY configured: ${Boolean(process.env.GROQ_API_KEY)}`);
});
