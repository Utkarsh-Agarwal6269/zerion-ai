(function () {
  "use strict";

  var DEFAULTS = {
    botName: "Zerion AI Advisor",
    subtitle: "Instant Assistant",
    theme: {
      headerBg: "#0f172a",
      primaryColor: "#2563eb",
      accentColor: "#38bdf8"
    },
    whatsappNumber: "",
    welcomeMessage: "Hello! How can I help you today?",
    quickReplies: [],
    knowledgeBase: [],
    knowledgeUrl: null,
    autoScanPage: true
  };

  var synonymGroups = [
    [/\b(kaha|kidhar|kahan|pata)\b/g, "address location"],
    [/\b(kitna|rate|fees|charges|price|cost)\b/g, "price cost rate"],
    [/\b(timings|timing|time|kab|khulta|band|khulna|bandh)\b/g, "timings open hours"],
    [/\b(byaj|interest)\b/g, "interest rate"],
    [/\b(lo?n|loan)\b/g, "loan"],
    [/\b(cibl|cibil|score)\b/g, "cibil score"],
    [/\b(sampark|number|call|contact)\b/g, "contact phone whatsapp"]
  ];

  function mergeTheme(base, override) {
    return Object.assign({}, base, override && typeof override === "object" ? override : {});
  }

  function normalize(text) {
    var value = String(text == null ? "" : text).toLowerCase();
    value = value.replace(/[^\w\s]/g, " ");
    value = value.replace(/\s+/g, " ").trim();
    synonymGroups.forEach(function (entry) {
      value = value.replace(entry[0], " " + entry[1] + " ");
    });
    return value.replace(/\s+/g, " ").trim();
  }

  function tokens(text) {
    var stopWords = {
      a: true, an: true, the: true, is: true, are: true, and: true,
      or: true, to: true, of: true, for: true, in: true, on: true,
      with: true, please: true, me: true, mera: true, meri: true,
      kya: true, ka: true, ki: true, hai: true
    };
    return normalize(text).split(" ").filter(function (word) {
      return word && word.length > 1 && !stopWords[word];
    });
  }

  function phraseMatches(text, phrase) {
    var source = normalize(text);
    var target = normalize(phrase);
    return target.length > 0 && source.indexOf(target) !== -1;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var previous = [];
    var i, j;
    for (j = 0; j <= b.length; j++) previous[j] = j;
    for (i = 1; i <= a.length; i++) {
      var current = [i];
      for (j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[b.length];
  }

  function fuzzyTokenMatch(a, b) {
    if (a === b) return 1;
    if (a.length < 4 || b.length < 4) return 0;
    var distance = levenshtein(a, b);
    var allowed = Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.25));
    if (distance <= allowed) return 1 - distance / Math.max(a.length, b.length);
    return 0;
  }

  function scoreEntry(query, entry) {
    var normalizedQuery = normalize(query);
    var queryTokens = tokens(query);
    var keywordText = Array.isArray(entry.keywords)
      ? entry.keywords.join(" ")
      : String(entry.keywords || "");
    var keywordList = Array.isArray(entry.keywords)
      ? entry.keywords
      : String(entry.keywords || "").split(/[,|]/).map(function (item) { return item.trim(); });
    var normalizedKeywords = normalize(keywordText);
    var score = 0;

    if (normalizedKeywords && normalizedQuery === normalizedKeywords) score += 0.7;
    if (normalizedKeywords && phraseMatches(normalizedQuery, normalizedKeywords)) score += 0.55;

    keywordList.forEach(function (keyword) {
      var clean = normalize(keyword);
      if (!clean) return;
      if (phraseMatches(normalizedQuery, clean)) score += 0.45;
    });

    var keywordTokens = tokens(keywordText);
    var matched = 0;
    queryTokens.forEach(function (queryToken) {
      var best = 0;
      keywordTokens.forEach(function (keywordToken) {
        if (queryToken === keywordToken) best = Math.max(best, 1);
        else best = Math.max(best, fuzzyTokenMatch(queryToken, keywordToken));
      });
      if (best > 0) matched += best;
    });
    if (queryTokens.length) score += (matched / queryTokens.length) * 0.45;

    var answerTokens = tokens(entry.answer || "");
    var answerMatches = 0;
    queryTokens.forEach(function (queryToken) {
      var best = 0;
      answerTokens.forEach(function (answerToken) {
        if (queryToken === answerToken) best = 1;
        else if (answerToken.indexOf(queryToken) === 0 || queryToken.indexOf(answerToken) === 0) best = 0.65;
        else best = Math.max(best, fuzzyTokenMatch(queryToken, answerToken));
      });
      if (best > 0) answerMatches += best;
    });
    if (queryTokens.length) score += (answerMatches / queryTokens.length) * 0.2;

    return Math.min(score, 1);
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    var style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (element.closest && element.closest('[aria-hidden="true"], [hidden], script, style, noscript')) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderFormatted(container, text) {
    var safe = escapeHtml(String(text == null ? "" : text));
    var formatted = safe
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\r\n|\r|\n/g, "<br>");
    container.innerHTML = formatted;
  }

  function createZerionAPI() {
    var state = {
      config: Object.assign({}, DEFAULTS, { theme: mergeTheme(DEFAULTS.theme) }),
      knowledgeBase: [],
      tools: [],
      host: null,
      shadow: null,
      launcher: null,
      panel: null,
      messages: null,
      input: null,
      unread: null,
      isOpen: false,
      leadCapture: null,
      sessionKey: null
    };

    function storageKey() {
      return "zerion_ai_chat_" + encodeURIComponent(state.config.botName);
    }

    function persist() {
      if (!state.shadow) return;
      var nodes = state.messages ? state.messages.querySelectorAll(".za-message") : [];
      var messages = [];
      nodes.forEach(function (node) {
        var role = node.classList.contains("za-user") ? "user" : "bot";
        var text = node.getAttribute("data-text") || "";
        var card = node.getAttribute("data-card");
        messages.push({ role: role, text: text, card: card });
      });
      try {
        sessionStorage.setItem(storageKey(), JSON.stringify({
          leadCapture: state.leadCapture,
          messages: messages
        }));
      } catch (error) {}
    }

    function restore() {
      var raw;
      try { raw = sessionStorage.getItem(storageKey()); } catch (error) { return; }
      if (!raw) {
        addBotMessage(state.config.welcomeMessage);
        return;
      }
      try {
        var saved = JSON.parse(raw);
        state.leadCapture = saved.leadCapture || null;
        if (Array.isArray(saved.messages) && saved.messages.length) {
          saved.messages.forEach(function (message) {
            if (message.card) addLeadCard(message.text, message.card, false);
            else if (message.role === "user") addUserMessage(message.text, false);
            else addBotMessage(message.text, false);
          });
        } else {
          addBotMessage(state.config.welcomeMessage);
        }
      } catch (error) {
        addBotMessage(state.config.welcomeMessage);
      }
    }

    function scrollMessages() {
      if (state.messages) {
        requestAnimationFrame(function () {
          state.messages.scrollTop = state.messages.scrollHeight;
        });
      }
    }

    function addUserMessage(text, shouldPersist) {
      if (!text || !state.messages) return;
      var row = document.createElement("div");
      row.className = "za-message za-user";
      row.setAttribute("data-text", text);
      var bubble = document.createElement("div");
      bubble.className = "za-bubble";
      bubble.textContent = text;
      row.appendChild(bubble);
      state.messages.appendChild(row);
      scrollMessages();
      if (shouldPersist !== false) persist();
    }

    function addBotMessage(text, shouldPersist) {
      if (text == null || !state.messages) return;
      var row = document.createElement("div");
      row.className = "za-message za-bot";
      row.setAttribute("data-text", String(text));
      var bubble = document.createElement("div");
      bubble.className = "za-bubble";
      renderFormatted(bubble, text);
      row.appendChild(bubble);
      state.messages.appendChild(row);
      scrollMessages();
      if (!state.isOpen && state.unread) state.unread.hidden = false;
      if (shouldPersist !== false) persist();
    }

    function addTyping() {
      var row = document.createElement("div");
      row.className = "za-message za-bot za-typing";
      row.innerHTML = '<div class="za-bubble za-dots"><i></i><i></i><i></i></div>';
      state.messages.appendChild(row);
      scrollMessages();
      return row;
    }

    function addLeadCard(question, visitorName, shouldPersist) {
      var row = document.createElement("div");
      row.className = "za-message za-bot";
      row.setAttribute("data-text", question);
      row.setAttribute("data-card", visitorName);
      var card = document.createElement("div");
      card.className = "za-lead-card";

      var title = document.createElement("strong");
      title.textContent = "Inquiry Summary";
      var name = document.createElement("div");
      name.innerHTML = "<span>Name</span> " + escapeHtml(visitorName);
      var inquiry = document.createElement("div");
      inquiry.innerHTML = "<span>Question</span> " + escapeHtml(question);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "za-whatsapp";
      button.textContent = "Send Inquiry on WhatsApp";
      button.addEventListener("click", function () {
        var number = String(state.config.whatsappNumber || "").replace(/\D/g, "");
        if (!number) {
          alert("WhatsApp number is not configured.");
          return;
        }
        var message = "Hello, my name is " + visitorName + ". " + question;
        window.open("https://wa.me/" + number + "?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
      });

      card.appendChild(title);
      card.appendChild(name);
      card.appendChild(inquiry);
      card.appendChild(button);
      row.appendChild(card);
      state.messages.appendChild(row);
      scrollMessages();
      if (!state.isOpen && state.unread) state.unread.hidden = false;
      if (shouldPersist !== false) persist();
    }

    function removeLeadCardData() {
      if (state.messages) {
        var nodes = state.messages.querySelectorAll("[data-card]");
        nodes.forEach(function (node) { node.removeAttribute("data-card"); });
      }
    }

    function renderQuickReplies() {
      var tray = state.shadow.querySelector(".za-quick-replies");
      if (!tray) return;
      tray.innerHTML = "";
      (state.config.quickReplies || []).forEach(function (text) {
        if (!text) return;
        var button = document.createElement("button");
        button.type = "button";
        button.className = "za-chip";
        button.textContent = text;
        button.addEventListener("click", function () { ask(String(text)); });
        tray.appendChild(button);
      });
      tray.hidden = !(state.config.quickReplies || []).length;
    }

    function buildCta(container, ctaText, ctaMessage, ctaWhatsapp) {
      if (!ctaText) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "za-cta";
      button.textContent = ctaText;
      button.addEventListener("click", function () {
        var number = String(state.config.whatsappNumber || "").replace(/\D/g, "");
        var whatsappRequested = ctaWhatsapp === true || /whatsapp/i.test(String(ctaText));
        if (number && whatsappRequested) {
          var message = ctaMessage == null || ctaMessage === "" ? ctaText : ctaMessage;
          window.open("https://wa.me/" + number + "?text=" + encodeURIComponent(String(message)), "_blank", "noopener,noreferrer");
          return;
        }
        ask(String(ctaMessage));
      });
      container.appendChild(button);
    }

    function addKnowledgeAnswer(answer, ctaText, ctaMessage, ctaWhatsapp) {
      var row = document.createElement("div");
      row.className = "za-message za-bot";
      row.setAttribute("data-text", String(answer));
      var bubble = document.createElement("div");
      bubble.className = "za-bubble";
      renderFormatted(bubble, answer);
      buildCta(bubble, ctaText, ctaMessage, ctaWhatsapp);
      row.appendChild(bubble);
      state.messages.appendChild(row);
      scrollMessages();
      if (!state.isOpen && state.unread) state.unread.hidden = false;
      persist();
    }

    function scanPage(query) {
      if (!state.config.autoScanPage) return null;
      var candidates = document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, article, [class*='card'], [class*='service'], [class*='feature']");
      var best = null;
      var bestScore = 0;
      candidates.forEach(function (element) {
        if (!isVisible(element)) return;
        var text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length < 20 || text.length > 600) return;
        var score = scoreEntry(query, { keywords: text, answer: text });
        if (score > bestScore) {
          bestScore = score;
          best = text;
        }
      });
      if (!best || bestScore < 0.16) return null;
      return best.length > 280 ? best.slice(0, 277) + "..." : best;
    }

    function runTool(question) {
      for (var i = 0; i < state.tools.length; i++) {
        var tool = state.tools[i];
        var regex = tool.regex;
        regex.lastIndex = 0;
        var match = regex.exec(question);
        if (!match) continue;
        try {
          var result = tool.handler(question, match);
          return Promise.resolve(result).then(function (value) {
            return value;
          });
        } catch (error) {
          return Promise.resolve({
            answer: "I could not complete that calculation. Please check the details and try again."
          });
        }
      }
      return null;
    }

    function renderToolResult(result) {
      if (typeof result === "string") {
        addKnowledgeAnswer(result);
      } else if (result && typeof result === "object") {
        addKnowledgeAnswer(result.answer || result.text || "", result.ctaText, result.ctaMessage, result.ctaWhatsapp);
      }
    }

    function processQuestion(question) {
      addUserMessage(question);
      if (state.leadCapture) {
        var name = String(question).trim();
        var originalQuestion = state.leadCapture.question;
        state.leadCapture = null;
        var typing = addTyping();
        setTimeout(function () {
          typing.remove();
          addLeadCard(originalQuestion, name);
        }, 350);
        return;
      }

      var typing = addTyping();
      var toolPromise = runTool(question);

      var finish = function () {
        if (toolPromise) {
          toolPromise.then(function (result) {
            typing.remove();
            if (result != null) renderToolResult(result);
            else findKnowledge(question);
          }).catch(function () {
            typing.remove();
            findKnowledge(question);
          });
        } else {
          findKnowledge(question);
        }
      };

      setTimeout(finish, 350);
    }

    function findKnowledge(question) {
      var typing = state.messages.querySelector(".za-typing");
      if (typing) typing.remove();

      var best = null;
      var bestScore = 0;
      state.knowledgeBase.forEach(function (entry) {
        var score = scoreEntry(question, entry);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      });

      if (best && bestScore >= 0.28) {
        addKnowledgeAnswer(best.answer, best.ctaText, best.ctaMessage, best.ctaWhatsapp);
        return;
      }

      var scanned = scanPage(question);
      if (scanned) {
        addKnowledgeAnswer(scanned);
        return;
      }

      state.leadCapture = { question: question };
      addBotMessage("I can help with that. May I know your name?");
    }

    function ask(questionText) {
      open();
      var text = String(questionText == null ? "" : questionText).trim();
      if (!text) return;
      processQuestion(text);
    }

    function open() {
      if (!state.host) return;
      state.isOpen = true;
      state.panel.classList.add("za-open");
      state.launcher.classList.add("za-active");
      state.launcher.setAttribute("aria-expanded", "true");
      if (state.unread) state.unread.hidden = true;
      setTimeout(function () {
        if (state.input) state.input.focus();
      }, 220);
    }

    function close() {
      if (!state.host) return;
      state.isOpen = false;
      state.panel.classList.remove("za-open");
      state.launcher.classList.remove("za-active");
      state.launcher.setAttribute("aria-expanded", "false");
    }

    function toggle() {
      state.isOpen ? close() : open();
    }

    function registerTool(name, regexPattern, handlerFn) {
      if (typeof regexPattern === "string") regexPattern = new RegExp(regexPattern, "i");
      if (!(regexPattern instanceof RegExp) || typeof handlerFn !== "function") {
        throw new TypeError("registerTool requires a name, a RegExp or string pattern, and a handler function.");
      }
      state.tools.push({ name: name, regex: regexPattern, handler: handlerFn });
    }

    function addKnowledge(itemsArray) {
      if (!Array.isArray(itemsArray)) throw new TypeError("addKnowledge requires an array.");
      var valid = itemsArray.filter(function (item) {
        return item && typeof item.answer === "string";
      });
      state.knowledgeBase = state.knowledgeBase.concat(valid);
      return valid.length;
    }

    function fetchKnowledgeUrl(url) {
      if (!url || typeof fetch !== "function") return Promise.resolve();
      return fetch(url).then(function (response) {
        if (!response.ok) throw new Error("Knowledge URL returned " + response.status);
        return response.json();
      }).then(function (payload) {
        var items = Array.isArray(payload) ? payload : payload.knowledgeBase;
        if (Array.isArray(items)) addKnowledge(items);
      }).catch(function () {});
    }

    function mount() {
      if (state.host) state.host.remove();
      state.host = document.createElement("div");
      state.host.id = "zerion-ai-widget";
      state.host.setAttribute("aria-live", "polite");
      document.body.appendChild(state.host);
      state.shadow = state.host.attachShadow({ mode: "open" });

      var theme = state.config.theme;
      var style = document.createElement("style");
      style.textContent =
        ":host{all:initial;position:fixed;bottom:20px;right:20px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}" +
        "*{box-sizing:border-box}" +
        ".za-launcher{position:absolute;right:0;bottom:0;height:56px;min-width:56px;border:0;border-radius:28px;background:" + theme.primaryColor + ";color:#fff;box-shadow:0 12px 30px rgba(15,23,42,.28);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 17px;font-size:14px;font-weight:700;transition:transform .25s,opacity .2s}" +
        ".za-launcher:hover{transform:translateY(-2px)}.za-launcher.za-active{transform:rotate(8deg) scale(.94)}.za-launcher svg{width:24px;height:24px;flex:none}.za-launcher-label{white-space:nowrap}" +
        ".za-unread{position:absolute;right:-2px;top:-2px;width:12px;height:12px;border-radius:50%;background:" + theme.accentColor + ";border:2px solid #fff}" +
        ".za-panel{position:absolute;right:0;bottom:72px;width:min(370px,calc(100vw - 32px));height:min(590px,calc(100vh - 112px));background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 24px 65px rgba(15,23,42,.28);border:1px solid rgba(15,23,42,.08);transform:translateY(18px) scale(.96);transform-origin:bottom right;opacity:0;pointer-events:none;transition:opacity .24s ease,transform .24s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column}" +
        ".za-panel.za-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}" +
        ".za-header{background:" + theme.headerBg + ";color:#fff;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;min-height:72px}.za-brand{display:flex;align-items:center;gap:10px}.za-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:" + theme.primaryColor + ";box-shadow:0 0 0 3px rgba(255,255,255,.12);font-weight:800}.za-name{font-size:15px;font-weight:800;line-height:1.2}.za-subtitle{font-size:11px;opacity:.72;margin-top:3px}.za-close{width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:21px;line-height:1;cursor:pointer}" +
        ".za-messages{flex:1;overflow-y:auto;padding:16px 14px 8px;background:linear-gradient(180deg,#f8fafc,#fff);scroll-behavior:smooth}.za-message{display:flex;margin:0 0 10px}.za-user{justify-content:flex-end}.za-bubble{max-width:82%;padding:10px 12px;border-radius:14px;font-size:13px;line-height:1.48;color:#1e293b;background:#edf2f7;overflow-wrap:anywhere}.za-user .za-bubble{background:" + theme.primaryColor + ";color:#fff;border-bottom-right-radius:4px}.za-bot .za-bubble{border-bottom-left-radius:4px}.za-bubble strong{font-weight:800}.za-dots{display:flex;gap:4px;padding:12px 14px}.za-dots i{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:za-bounce 1s infinite ease-in-out}.za-dots i:nth-child(2){animation-delay:.12s}.za-dots i:nth-child(3){animation-delay:.24s}@keyframes za-bounce{0%,60%,100%{transform:translateY(0);opacity:.55}30%{transform:translateY(-4px);opacity:1}}" +
        ".za-quick-replies{display:flex;gap:6px;padding:8px 10px;overflow-x:auto;border-top:1px solid #eef2f7;background:#fff}.za-chip{border:1px solid " + theme.primaryColor + ";background:#fff;color:" + theme.primaryColor + ";border-radius:999px;padding:7px 10px;font-size:12px;white-space:nowrap;cursor:pointer}.za-cta{display:block;margin-top:9px;border:0;border-radius:8px;background:" + theme.primaryColor + ";color:#fff;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer}" +
        ".za-compose{display:flex;gap:8px;padding:10px;border-top:1px solid #e8edf3;background:#fff}.za-input{min-width:0;flex:1;height:42px;border:1px solid #dbe3ec;border-radius:10px;padding:0 12px;font:inherit;font-size:13px;color:#0f172a;outline:none}.za-input:focus{border-color:" + theme.primaryColor + ";box-shadow:0 0 0 3px " + theme.primaryColor + "20}.za-send{width:42px;height:42px;border:0;border-radius:10px;background:" + theme.primaryColor + ";color:#fff;font-weight:800;cursor:pointer}.za-send:hover{filter:brightness(.94)}" +
        ".za-footer{text-align:center;padding:5px 8px 8px;color:#94a3b8;font-size:9px;background:#fff}.za-lead-card{max-width:88%;border:1px solid #dbe3ec;border-radius:12px;padding:12px;background:#fff;box-shadow:0 6px 18px rgba(15,23,42,.08);font-size:12px;color:#334155}.za-lead-card strong{display:block;font-size:13px;color:#0f172a;margin-bottom:8px}.za-lead-card div{margin:5px 0;overflow-wrap:anywhere}.za-lead-card div span{display:inline-block;width:58px;color:#64748b;font-size:10px;text-transform:uppercase}.za-whatsapp{width:100%;border:0;border-radius:8px;margin-top:9px;background:#25d366;color:#fff;padding:9px 8px;font-size:12px;font-weight:800;cursor:pointer}" +
        "@media(max-width:480px){:host{bottom:12px;right:12px}.za-panel{right:0;bottom:68px;width:calc(100vw - 24px);height:calc(100vh - 92px)}.za-launcher-label{display:none}.za-launcher{width:56px;padding:0}}";

      state.shadow.innerHTML =
        "<style></style>" +
        '<button class="za-launcher" type="button" aria-expanded="false" aria-label="Open ' + escapeHtml(state.config.botName) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a7 7 0 0 0-7 7v2a7 7 0 0 0 7 7h1l4 3v-4.1A7 7 0 0 0 19 12v-2a7 7 0 0 0-7-7Z" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="11" r="1" fill="currentColor"/><circle cx="15" cy="11" r="1" fill="currentColor"/></svg>' +
        '<span class="za-launcher-label">Chat</span><span class="za-unread" hidden></span></button>' +
        '<section class="za-panel" role="dialog" aria-label="' + escapeHtml(state.config.botName) + '">' +
        '<header class="za-header"><div class="za-brand"><div class="za-avatar">' + escapeHtml(state.config.botName.charAt(0).toUpperCase() || "Z") + '</div><div><div class="za-name">' + escapeHtml(state.config.botName) + '</div><div class="za-subtitle">' + escapeHtml(state.config.subtitle) + '</div></div></div><button class="za-close" type="button" aria-label="Close">&times;</button></header>' +
        '<div class="za-messages" role="log" aria-live="polite"></div>' +
        '<div class="za-quick-replies"></div>' +
        '<form class="za-compose"><input class="za-input" type="text" placeholder="Type your question..." autocomplete="off" aria-label="Your question"><button class="za-send" type="submit" aria-label="Send">Send</button></form>' +
        '<div class="za-footer">Powered by Zerion AI</div></section>';

      state.shadow.querySelector("style").textContent = style.textContent;
      state.launcher = state.shadow.querySelector(".za-launcher");
      state.panel = state.shadow.querySelector(".za-panel");
      state.messages = state.shadow.querySelector(".za-messages");
      state.input = state.shadow.querySelector(".za-input");
      state.unread = state.shadow.querySelector(".za-unread");

      state.launcher.addEventListener("click", toggle);
      state.shadow.querySelector(".za-close").addEventListener("click", close);
      state.shadow.querySelector(".za-compose").addEventListener("submit", function (event) {
        event.preventDefault();
        var text = state.input.value.trim();
        if (!text) return;
        state.input.value = "";
        processQuestion(text);
      });

      renderQuickReplies();
      restore();
    }

    function init(config) {
      config = config && typeof config === "object" ? config : {};
      state.config = Object.assign({}, DEFAULTS, config, {
        theme: mergeTheme(DEFAULTS.theme, config.theme)
      });
      state.knowledgeBase = Array.isArray(config.knowledgeBase)
        ? config.knowledgeBase.slice()
        : [];
      mount();
      fetchKnowledgeUrl(state.config.knowledgeUrl);
      return api;
    }

    var api = {
      init: init,
      open: open,
      close: close,
      toggle: toggle,
      ask: ask,
      registerTool: registerTool,
      addKnowledge: addKnowledge
    };

    return api;
  }

  window.ZerionAI = createZerionAPI();
})();
