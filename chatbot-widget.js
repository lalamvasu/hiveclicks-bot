/**
 * HiveClicks Chat Assistant — embeddable widget
 * ------------------------------------------------
 * Drop this on any page with:
 *   <script src="https://YOUR-BACKEND-URL/widget/chatbot-widget.js"
 *           data-api="https://YOUR-BACKEND-URL"></script>
 *
 * No build step, no dependencies. Self-contained: injects its own CSS + HTML.
 */
(function () {
  "use strict";

  var scriptTag = document.currentScript;
  var API_BASE = (scriptTag && scriptTag.getAttribute("data-api")) || "";
  if (!API_BASE) {
    console.warn("[HiveClicks widget] Missing data-api attribute on the script tag.");
    return;
  }

  // ---------- design tokens ----------
  var INK = "#12283D";
  var HONEY = "#2DD4BF";
  var HONEY_DARK = "#15B8A6";
  var CREAM = "#F1FBFA";
  var SLATE = "#5B6470";
  var WHITE = "#FFFFFF";

  // ---------- session id (persists across page loads) ----------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  var SESSION_KEY = "hiveclicks_chat_session";
  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = uuid();
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  // ---------- styles ----------
  var css = "\
    .hc-launcher{position:fixed;bottom:100px;right:22px;width:64px;height:64px;\
      background:" + HONEY + ";clip-path:polygon(25% 3%,75% 3%,100% 50%,75% 97%,25% 97%,0% 50%);cursor:pointer;\
      display:flex;align-items:center;justify-content:center;\
      box-shadow:0 8px 24px rgba(20,23,26,.32);z-index:999998;\
      transition:transform .15s ease;}\
    .hc-launcher:hover{transform:translateY(-2px) scale(1.03);}\
    .hc-launcher-inner{width:54px;height:54px;background:" + INK + ";\
      clip-path:polygon(25% 3%,75% 3%,100% 50%,75% 97%,25% 97%,0% 50%);\
      display:flex;align-items:center;justify-content:center;font-size:26px;line-height:1;}\
    .hc-greet{position:fixed;bottom:114px;right:96px;max-width:230px;\
      background:" + WHITE + ";color:" + INK + ";padding:12px 14px;border-radius:12px 12px 4px 12px;\
      font:500 13.5px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\
      box-shadow:0 6px 20px rgba(20,23,26,.16);z-index:999997;\
      animation:hc-pop .25s ease-out;}\
    .hc-greet button{position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;\
      background:" + INK + ";color:#fff;border:none;font-size:12px;cursor:pointer;line-height:1;}\
    @keyframes hc-pop{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}\
    .hc-panel{position:fixed;bottom:174px;right:22px;width:360px;max-width:92vw;height:520px;max-height:75vh;\
      background:" + CREAM + ";border-radius:16px;box-shadow:0 16px 48px rgba(20,23,26,.3);\
      display:none;flex-direction:column;overflow:hidden;z-index:999999;\
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}\
    .hc-panel.hc-open{display:flex;}\
    .hc-header{background:" + INK + ";color:#fff;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;}\
    .hc-header-title{font-size:15px;font-weight:600;}\
    .hc-header-sub{font-size:11.5px;color:" + HONEY + ";margin-top:2px;font-weight:500;}\
    .hc-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;opacity:.8;}\
    .hc-close:hover{opacity:1;}\
    .hc-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;}\
    .hc-msg{max-width:82%;padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;}\
    .hc-msg.bot{background:#fff;color:" + INK + ";align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(20,23,26,.08);}\
    .hc-msg.user{background:" + HONEY + ";color:" + INK + ";align-self:flex-end;border-bottom-right-radius:4px;font-weight:500;}\
    .hc-typing{display:flex;gap:4px;align-self:flex-start;padding:10px 13px;}\
    .hc-hex{width:6px;height:6px;background:" + HONEY + ";clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);\
      animation:hc-bounce 1s infinite ease-in-out;}\
    .hc-hex:nth-child(2){animation-delay:.15s;}.hc-hex:nth-child(3){animation-delay:.3s;}\
    @keyframes hc-bounce{0%,60%,100%{opacity:.35;transform:translateY(0);}30%{opacity:1;transform:translateY(-3px);}}\
    .hc-footer{padding:12px;border-top:1px solid #EFE3CE;background:#fff;display:flex;gap:8px;}\
    .hc-input{flex:1;border:1.5px solid #E8DCC4;border-radius:10px;padding:9px 12px;font-size:13.5px;outline:none;\
      font-family:inherit;resize:none;}\
    .hc-input:focus{border-color:" + HONEY + ";}\
    .hc-send{background:" + INK + ";color:#fff;border:none;border-radius:10px;width:38px;cursor:pointer;\
      display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:17px;line-height:1;}\
    .hc-send:hover{background:" + HONEY_DARK + ";}\
    .hc-send:disabled{opacity:.4;cursor:default;}\
    .hc-fallback{margin-top:6px;font-size:12px;color:" + SLATE + ";}\
    .hc-fallback a{color:" + HONEY_DARK + ";font-weight:600;text-decoration:none;}\
    @media (max-width:480px){.hc-panel{right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0;}\
      .hc-launcher{bottom:90px;right:16px;}.hc-greet{right:16px;bottom:166px;}}\
  ";
  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- markup ----------
  var root = document.createElement("div");
  root.innerHTML = "\
    <div class='hc-greet' id='hcGreet'>\
      <button id='hcGreetClose' aria-label='Dismiss'>&times;</button>\
      \uD83D\uDC4B Need help growing your business online? Ask me anything!\
    </div>\
    <div class='hc-launcher' id='hcLauncher' aria-label='Open chat'>\
      <div class='hc-launcher-inner'>\uD83D\uDC1D</div>\
    </div>\
    <div class='hc-panel' id='hcPanel'>\
      <div class='hc-header'>\
        <div><div class='hc-header-title'>Scout \u2014 HiveClicks Assistant</div><div class='hc-header-sub'>Usually replies in a few seconds</div></div>\
        <button class='hc-close' id='hcClose' aria-label='Close chat'>&times;</button>\
      </div>\
      <div class='hc-body' id='hcBody'></div>\
      <div class='hc-footer'>\
        <textarea class='hc-input' id='hcInput' rows='1' placeholder='Type a message...'></textarea>\
        <button class='hc-send' id='hcSend' aria-label='Send'>&#10148;</button>\
      </div>\
    </div>\
  ";
  document.body.appendChild(root);

  var launcher = document.getElementById("hcLauncher");
  var panel = document.getElementById("hcPanel");
  var body = document.getElementById("hcBody");
  var input = document.getElementById("hcInput");
  var sendBtn = document.getElementById("hcSend");
  var closeBtn = document.getElementById("hcClose");
  var greet = document.getElementById("hcGreet");
  var greetClose = document.getElementById("hcGreetClose");

  var opened = false;
  var busy = false;

  function addMsg(text, who) {
    var div = document.createElement("div");
    div.className = "hc-msg " + who;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  function addFallback() {
    var div = document.createElement("div");
    div.className = "hc-msg bot";
    div.innerHTML =
      "I don't have that answer handy — but our team will! You can:<br>" +
      "\u2709\uFE0F <a href='mailto:" + FALLBACK_EMAIL + "' style='color:" + HONEY_DARK + ";font-weight:600;'>Email us</a><br>" +
      "\uD83D\uDCDE <a href='tel:" + FALLBACK_PHONE + "' style='color:" + HONEY_DARK + ";font-weight:600;'>Call " + FALLBACK_PHONE_DISPLAY + "</a><br>" +
      "\uD83D\uDCAC <a href='https://wa.me/" + FALLBACK_WHATSAPP + "' target='_blank' rel='noopener' style='color:" + HONEY_DARK + ";font-weight:600;'>Message us on WhatsApp</a>";
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  // Update these to match your business — also used server-side, but shown
  // here so the fallback renders instantly without waiting on a reply.
  var FALLBACK_EMAIL = "contact@hiveclicks.com";
  var FALLBACK_PHONE = "+917337483053";
  var FALLBACK_PHONE_DISPLAY = "+91 73374 83053";
  var FALLBACK_WHATSAPP = "917337483053";

  function showTyping() {
    var div = document.createElement("div");
    div.className = "hc-typing";
    div.id = "hcTypingIndicator";
    div.innerHTML = "<div class='hc-hex'></div><div class='hc-hex'></div><div class='hc-hex'></div>";
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }
  function hideTyping() {
    var el = document.getElementById("hcTypingIndicator");
    if (el) el.remove();
  }

  function openPanel() {
    panel.classList.add("hc-open");
    greet.style.display = "none";
    if (!opened) {
      opened = true;
      addMsg(
        "Hi, I'm Scout! \uD83D\uDC1D I help out here at HiveClicks. What's your name?",
        "bot"
      );
    }
    input.focus();
  }
  launcher.addEventListener("click", openPanel);
  function notifyEndSession() {
    if (!opened) return; // never started a real conversation
    var payload = JSON.stringify({ sessionId: sessionId, pageUrl: location.href });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_BASE + "/api/end-session", new Blob([payload], { type: "application/json" }));
    } else {
      fetch(API_BASE + "/api/end-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    }
  }

  closeBtn.addEventListener("click", function () {
    panel.classList.remove("hc-open");
    notifyEndSession();
  });
  window.addEventListener("beforeunload", notifyEndSession);

  var idleTimer = null;
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(notifyEndSession, 15000);
  }
  greetClose.addEventListener("click", function (e) {
    e.stopPropagation();
    greet.style.display = "none";
  });
  greet.addEventListener("click", openPanel);

  setTimeout(function () {
    if (!opened) greet.style.display = "block";
  }, 4000);

  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    addMsg(text, "user");
    input.value = "";
    busy = true;
    sendBtn.disabled = true;
    showTyping();
    resetIdleTimer();

    fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, message: text, pageUrl: location.href }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("bad response");
        return r.json();
      })
      .then(function (data) {
        hideTyping();
        addMsg(data.reply || "Sorry, could you rephrase that?", "bot");
        if (data.unresolved) addFallback();
        resetIdleTimer();
      })
      .catch(function () {
        hideTyping();
        addFallback();
        resetIdleTimer();
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
      });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
})();
