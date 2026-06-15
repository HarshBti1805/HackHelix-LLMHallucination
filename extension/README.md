# Groundtruth Browser Extension

Audits **ChatGPT**, **Claude**, and **Gemini** answers *in their native web UIs*.
The UI matches the Groundtruth web app (warm cream/terracotta theme,
emerald/amber/orange/rose verdicts) and is **not** a sidebar.

How it works:

- Click the toolbar icon → a small **launcher** appears with a single
  **"Start auditing"** button.
- After Start, each new assistant response is sent to your running Groundtruth
  backend (`/api/audit`) and gets a compact **badge** anchored to its top-right
  corner (e.g. _"2 issues"_, _"checked"_, _"no claims"_).
- **Hover (or click) the badge** to open a **popover** showing where the answer
  is wrong: per-claim verdicts, confidence, agent agreement, and the full
  3-agent breakdown (Prosecutor / Defender / Literalist). While the popover is
  open, the flagged **sentences are highlighted inline** on the page — without
  modifying the page DOM, using the CSS Custom Highlight API, so it never fights
  the site's React/Angular rendering.
- Any flagged response gets a **"Copy grounded re-prompt"** button. It calls
  `/api/dehallucinate` and copies the grounded rewrite prompt to your clipboard,
  ready to paste back into the chat (the extension can't call the chat
  providers' APIs, so this is the in-place dehallucinate loop).

The key architectural win: the Groundtruth auditor is already provider-agnostic
and **text-only** — it sees only response text, never provenance — so there is
**no per-provider auditor logic**. The extension only needs small per-site DOM
adapters (`src/content/adapters/*`).

---

## How it fits the backend

The extension is a pure client of the existing API. It adds **no** auditor
logic, no new LLM calls, and no persistence — it reuses the contracts in
`types.ts`:

| Action | Endpoint | Request | Response |
|---|---|---|---|
| Audit a response | `POST /api/audit` | `{ message_id, content }` | `MessageAudit` |
| Grounded re-prompt | `POST /api/dehallucinate` | `{ originalUserMessage, flawedResponse, audit }` | `{ suggested_prompt }` |

Network calls run in the **background service worker** (`src/background.js`) so
they execute with the extension's host permissions and bypass the chat site's
page CORS policy. The content script never fetches the API directly.

---

## Install (Chrome / Edge / Brave — unpacked)

1. Start the Groundtruth backend (from the repo root):

   ```bash
   npm run dev   # serves http://localhost:3000
   ```

2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. (Optional) Open the extension's **Options** to point it at a non-local
   backend. Localhost works out of the box; other origins prompt for host
   access on save.
5. Visit `chatgpt.com`, `claude.ai`, or `gemini.google.com`, click the toolbar
   icon, hit **Start auditing**, then ask something fact-checkable (e.g.
   *"Summarize the findings of Johnson et al. 2021 on intermittent fasting."*).
   When the reply finishes, hover the badge that appears on it.

Click the toolbar icon any time to re-open the launcher (Stop / Re-check
latest / Settings).

---

## Settings & behavior

- **Start / Stop** (launcher): auditing only runs after you click Start; the
  choice is remembered per browser. Responses already on screen when you start
  are **not** auto-audited (to avoid auditing an entire prior conversation /
  burning rate limits) — use **"Re-check latest"** for those.
- **API base URL** (Options page): default `http://localhost:3000`.

---

## Files

```
extension/
├── manifest.json                  # MV3: content scripts, background, perms
├── src/
│   ├── background.js              # API proxy (audit + dehallucinate), icon click
│   ├── options/                   # API base URL config + permission request
│   └── content/
│       ├── config.js              # shared namespace + helpers
│       ├── audit-client.js        # content → background bridge
│       ├── adapters/
│       │   ├── base.js            # adapter registry + DOM helpers
│       │   ├── chatgpt.js         # chatgpt.com / chat.openai.com
│       │   ├── claude.js          # claude.ai
│       │   └── gemini.js          # gemini.google.com
│       ├── ui/
│       │   ├── highlights.{js,css}# non-destructive inline verdict highlights
│       │   └── overlay.js         # Shadow-DOM launcher + per-response badges + popover
│       └── index.js               # orchestrator: detect → audit → render
└── icons/                         # generated (generate_icons.py)
```

## Completion detection

Site DOMs change often, so completion isn't tied to a single fragile selector.
Each adapter only has to *find* assistant message elements and the composer; the
shared orchestrator treats a message as "done" once its text has been **stable
for ~1.5s** and the adapter doesn't report active streaming. This degrades
gracefully when a site ships a redesign.

## Notes / limitations

- Selectors for Claude and Gemini are class/structure based and may drift with
  site redesigns; ChatGPT uses stable `data-message-author-role` attributes.
- The clipboard write for the grounded re-prompt happens on a user click
  (button press) to satisfy browser gesture requirements.
- Audits cost real LLM + search calls on your backend; auto-audit only fires on
  genuinely new responses for this reason.
