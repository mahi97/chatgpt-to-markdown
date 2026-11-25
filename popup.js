const $ = (id) => document.getElementById(id);
const status = (msg, err = false) => { $("status").textContent = msg; $("status").className = err ? "err" : ""; };

async function run() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
    throw new Error("Open a ChatGPT conversation tab first.");
  }
  const msg = { type: "EXPORT_CHAT", opts: { timestamps: $("ts").checked } };
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // tab was open before the extension was installed: inject the script, retry
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    res = await chrome.tabs.sendMessage(tab.id, msg);
  }
  if (!res?.ok) throw new Error(res?.error || "Export failed");
  return res;
}

async function withBusy(fn) {
  const btns = document.querySelectorAll("button");
  btns.forEach((b) => (b.disabled = true));
  status("Exporting…");
  try { await fn(); } catch (e) { status(e.message, true); }
  btns.forEach((b) => (b.disabled = false));
}

$("download").onclick = () => withBusy(async () => {
  const r = await run();
  const url = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: r.filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  status(`Saved ${r.filename} (${r.method === "api" ? "full history" : "page scrape"})`);
});

$("copy").onclick = () => withBusy(async () => {
  const r = await run();
  await navigator.clipboard.writeText(r.markdown);
  status("Copied to clipboard");
});
