(() => {
  if (window.__chatgptMdExporterLoaded) return;
  window.__chatgptMdExporterLoaded = true;

  // ---------- helpers ----------
  const getConversationId = () => {
    const m = location.pathname.match(/\/c\/([0-9a-fA-F-]{8,})/);
    return m ? m[1] : null;
  };

  const cleanText = (s) => {
    if (!s) return "";
    // entity markers: entity["type","name",...] -> name
    s = s.replace(/entity(\[[\s\S]*?\])/g, (_, json) => {
      try { const a = JSON.parse(json); return a[1] || ""; } catch { return ""; }
    });
    // citations / other private-use wrapped markers -> removed
    s = s.replace(/[\s\S]*?/g, "");
    s = s.replace(/[-]/g, "");
    return s;
  };

  const fence = (code, lang = "") => {
    let f = "```";
    while (code.includes(f)) f += "`";
    return `${f}${lang}\n${code.replace(/\n$/, "")}\n${f}`;
  };

  // ---------- API path (complete, un-virtualised history) ----------
  async function fetchViaApi() {
    const id = getConversationId();
    if (!id) throw new Error("Open a conversation first (URL should contain /c/...)");
    const sessRes = await fetch("/api/auth/session", { credentials: "include" });
    if (!sessRes.ok) throw new Error("session " + sessRes.status);
    const sess = await sessRes.json();
    if (!sess.accessToken) throw new Error("no access token");
    const headers = { Authorization: "Bearer " + sess.accessToken };
    if (sess.account?.id) headers["ChatGPT-Account-Id"] = sess.account.id;
    const res = await fetch(`/backend-api/conversation/${id}`, { credentials: "include", headers });
    if (!res.ok) throw new Error("conversation " + res.status);
    return await res.json();
  }

  function partToMarkdown(part) {
    if (typeof part === "string") return cleanText(part);
    if (part && typeof part === "object") {
      if (part.content_type === "image_asset_pointer") return "*[image]*";
      if (part.content_type === "audio_transcription" && part.text) return cleanText(part.text);
      if (part.text) return cleanText(part.text);
    }
    return "";
  }

  function messageToMarkdown(msg) {
    const c = msg.content;
    if (!c) return "";
    switch (c.content_type) {
      case "text":
      case "multimodal_text":
        return (c.parts || []).map(partToMarkdown).filter(Boolean).join("\n\n");
      case "code":
        return fence(c.text || "", c.language && c.language !== "unknown" ? c.language : "");
      case "execution_output":
        return fence(c.text || "");
      default:
        return "";
    }
  }

  function apiToMarkdown(data, opts = {}) {
    const mapping = data.mapping || {};
    // walk current branch from leaf to root
    const chain = [];
    let node = data.current_node;
    while (node && mapping[node]) {
      chain.push(mapping[node]);
      node = mapping[node].parent;
    }
    chain.reverse();

    const out = [];
    for (const n of chain) {
      const m = n.message;
      if (!m) continue;
      const role = m.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      if (m.metadata?.is_visually_hidden_from_conversation) continue;
      if (role === "assistant" && m.recipient && m.recipient !== "all") continue; // tool calls
      let body = messageToMarkdown(m).trim();
      if (!body) continue;
      // user-attached files
      const atts = m.metadata?.attachments;
      if (Array.isArray(atts) && atts.length) {
        body += "\n\n" + atts.map((a) => `*[attachment: ${a.name || "file"}]*`).join("\n");
      }
      out.push({ role, body, time: m.create_time });
    }
    return render(data.title || document.title, out, data.create_time, opts);
  }

  // ---------- DOM fallback ----------
  function nodeToMd(node, ctx = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      return ctx.pre ? node.textContent : node.textContent.replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    if (["button", "svg", "style", "script", "textarea"].includes(tag)) return "";
    if (node.getAttribute("aria-hidden") === "true" && !node.textContent.trim()) return "";
    const kids = (c = ctx) => Array.from(node.childNodes).map((n) => nodeToMd(n, c)).join("");

    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        return `\n\n${"#".repeat(+tag[1])} ${kids().trim()}\n\n`;
      case "p": return `\n\n${kids().trim()}\n\n`;
      case "br": return "  \n";
      case "hr": return "\n\n---\n\n";
      case "strong": case "b": { const t = kids().trim(); return t ? `**${t}**` : ""; }
      case "em": case "i": { const t = kids().trim(); return t ? `*${t}*` : ""; }
      case "del": case "s": return `~~${kids()}~~`;
      case "a": {
        const t = kids().trim(); const h = node.getAttribute("href");
        return h && t ? `[${t}](${h})` : t;
      }
      case "img": {
        const src = node.getAttribute("src") || "";
        return src.startsWith("data:") ? "*[image]*" : `![${node.alt || "image"}](${src})`;
      }
      case "code":
        if (node.closest("pre")) return node.textContent;
        return "`" + node.textContent.replace(/`/g, "\\`") + "`";
      case "pre": {
        const codeEl = node.querySelector("code");
        const cls = (codeEl?.className || "") + " " + (node.className || "");
        const lm = cls.match(/language-([\w+#-]+)/);
        let lang = lm ? lm[1] : "";
        if (!lang) {
          // ChatGPT shows the language in a header label above the code
          const label = node.querySelector("div.flex.items-center span, [class*='language']");
          const t = label?.textContent?.trim();
          if (t && /^[\w+#.-]{1,20}$/.test(t)) lang = t.toLowerCase();
        }
        const text = (codeEl || node).textContent;
        return "\n\n" + fence(text, lang) + "\n\n";
      }
      case "blockquote": {
        const inner = kids().trim().split("\n").map((l) => "> " + l).join("\n");
        return `\n\n${inner}\n\n`;
      }
      case "ul": case "ol": {
        const items = Array.from(node.children).filter((c) => c.tagName === "LI");
        const depth = ctx.depth || 0;
        const lines = items.map((li, i) => {
          const bullet = tag === "ol" ? `${i + 1}.` : "-";
          const body = Array.from(li.childNodes).map((n) => nodeToMd(n, { ...ctx, depth: depth + 1 })).join("").trim();
          const indented = body.split("\n").map((l, j) => (j === 0 ? l : "  " + l)).join("\n");
          return `${"  ".repeat(depth)}${bullet} ${indented}`;
        });
        return `\n${lines.join("\n")}\n` + (depth ? "" : "\n");
      }
      case "table": {
        const rows = Array.from(node.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.children).map((c) => nodeToMd(c, ctx).trim().replace(/\|/g, "\\|").replace(/\n+/g, " "))
        );
        if (!rows.length) return "";
        const w = Math.max(...rows.map((r) => r.length));
        const pad = (r) => r.concat(Array(w - r.length).fill(""));
        const lines = [`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(w).fill("---").join(" | ")} |`];
        rows.slice(1).forEach((r) => lines.push(`| ${pad(r).join(" | ")} |`));
        return `\n\n${lines.join("\n")}\n\n`;
      }
      default:
        return kids();
    }
  }

  function domToMarkdown(opts = {}) {
    const els = document.querySelectorAll("[data-message-author-role]");
    if (!els.length) throw new Error("No messages found on this page.");
    const out = [];
    els.forEach((el) => {
      const role = el.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") return;
      let body;
      if (role === "assistant") {
        const root = el.querySelector(".markdown") || el;
        body = nodeToMd(root);
      } else {
        const t = el.querySelector(".whitespace-pre-wrap");
        body = t ? t.textContent : el.innerText;
      }
      body = cleanText(body).replace(/\n{3,}/g, "\n\n").trim();
      if (body) out.push({ role, body });
    });
    return render(document.title, out, null, opts);
  }

  // ---------- rendering ----------
  function render(title, msgs, createTime, opts = {}) {
    const lines = [];
    lines.push(`# ${(title || "ChatGPT conversation").replace(/\n/g, " ")}`, "");
    const meta = [`Exported: ${new Date().toISOString()}`, `Source: ${location.href}`];
    if (createTime) meta.unshift(`Started: ${new Date(createTime * 1000).toISOString()}`);
    meta.forEach((m) => lines.push(`*${m}*  `));
    lines.push("", "---", "");
    for (const m of msgs) {
      lines.push(`## ${m.role === "user" ? "🧑 User" : "🤖 ChatGPT"}`, "");
      if (opts.timestamps && m.time) lines.push(`*${new Date(m.time * 1000).toLocaleString()}*`, "");
      lines.push(m.body, "", "---", "");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  async function exportChat(opts = {}) {
    let method = "api", markdown;
    try {
      markdown = apiToMarkdown(await fetchViaApi(), opts);
      if (!/\n## /.test(markdown)) throw new Error("empty API result");
    } catch (e) {
      console.warn("[ChatGPT→MD] API path failed, using DOM fallback:", e);
      method = "dom";
      markdown = domToMarkdown(opts);
    }
    const title = (document.title || "chatgpt-conversation")
      .replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "chatgpt-conversation";
    return { markdown, method, filename: `${title}.md` };
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
      if (req?.type !== "EXPORT_CHAT") return;
      exportChat(req.opts || {})
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true; // async response
    });
  }

  if (typeof module !== "undefined") module.exports = { apiToMarkdown, nodeToMd, cleanText };
})();
