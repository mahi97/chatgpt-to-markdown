# ChatGPT to Markdown

A Chrome extension (Manifest V3) that saves the complete ChatGPT conversation you have open as a single Markdown file.

## Install
1. Clone or download this repo.
2. Open `chrome://extensions` and enable Developer mode.
3. Click **Load unpacked** and select this folder.

## Use
Open a conversation on chatgpt.com, click the extension icon, then **Download .md** or **Copy to clipboard**.

## How it works
- Primary: reads the full conversation (current branch) from ChatGPT's backend using your logged-in session.
- Fallback: scrapes the rendered page and converts it to Markdown (code blocks, tables, lists, links).
- Nothing leaves your browser.

Note: the primary path relies on an undocumented API and may break if OpenAI changes it.

## License
MIT
