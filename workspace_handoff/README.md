# Workspace Audit — UI handoff

Rebuild the **Workspace Audit** tab to match the reference design exactly. This is a **UI-only** change — keep all existing data, connector OAuth, document-fetch, and audit-pipeline logic wired up. Only the presentation changes.

## Reference file
`Workspace-Audit.reference.dc.html` — the complete, working design. **Open it in a browser and read its source end-to-end.** It is the pixel-exact source of truth:
- The `<style>` block holds the full **token system** (7 palettes × dark/light, verdict colors, shadows). Copy values verbatim — never approximate a color.
- The logic class (`class Component`) holds all view data + copy. Mirror the structure; wire your real data into the same shapes.
- When any detail is ambiguous, **the reference HTML wins** — match its exact inline values.

> The reference opens directly in a browser (it loads `support.js` from the same folder). Keep both files together.

## What the page is
A **persistent audit chat**, not a form. The user connects workspace sources, asks in plain language, and results stream back as turns in a scrolling transcript. Follow-ups reuse the previously selected docs (conversation memory) — no re-selecting.

## Shell (every state)
- Full-height `100vh` flex column.
- **52px nav bar** — left: `← Groundtruth` back link; right: a row of per-connector status badges.
- **Scrollable transcript** fills the middle.
- **Composer bar** pinned to the bottom with a blurred backdrop (`backdrop-filter: blur(10px)`).

## Connector badges (nav, right) — four states
- **Connected** — bordered pill: brand logo mark + green glowing dot + account name + ✕ disconnect.
- **Not connected** — `Connect [Name]` link button with brand logo.
- **Needs setup** — dashed-border pill, `(set up)` label in amber, tooltip naming the env vars to set.
- Connectors shown: **Notion, Google Drive, Gmail, Slack** — each with its real brand logo mark inline.

## States to build (the reference shows all four as stacked frames)
1. **Not connected** — centered empty state: heading "Audit your docs by just asking.", description, a 2-up auto-fit **connector cards** grid (logo + name + short desc + Connect button / green "On" indicator / grayed "—" for setup-needed). Composer dimmed to ~60% opacity, placeholder "Connect a source to start."
2. **Connected, composing** — **doc-picker popover** floats above the composer: source tabs (active tab = top border + tinted bg), search input (debounced 280ms, Enter to search, Esc to close), checkbox result rows (checkbox + title + last-edited mono-faint right + 2-line snippet; selected rows get accent border + tint). Composer shows attachment chips (logo + title + ✕), typed instruction, a "Find docs" toggle (accent when picker open), `⌘↵` hint, and the violet **Audit** send button.
3. **Results — faithfulness check** — a completed turn: right-aligned **user bubble** (doc chips + instruction) then a left-aligned **result card** (border + shadow). Card = header bar (mode pill + note + Report/JSON/CSV ghost buttons), doc role chips (`source`/`subject`/etc. in tiny mono uppercase), summary bar (Grounded / Not in source / Contradicted chips + Faithful %), claim rows (left 3px verdict stripe + glowing dot + claim text + rationale box + optional supporting-quote blockquote), and a **NEXT** follow-up row with contextual pill buttons.
4. **Results — multi-turn** — two stacked turns proving conversation memory: a **Web fact-check** (shared summary bar + expandable claim list with Prosecutor/Defender/Literalist breakdown) followed by a **Citation dossier** follow-up on the *same* docs (summary bar with supporting/contradicting/total counts, then citation cards — each with claim text + stance + a two-column Supporting/Contradicting grid of bordered left-stripe source links with domain + 2-line snippet).

## Audit modes (routing)
The result card adapts to which path the backend took, shown as a violet mode pill:
- **Faithfulness check** — claims vs. the provided source docs (groundedness). Verdicts: Grounded (verified-green), Not in source (unverified-amber), Contradicted (contradicted-orange).
- **Web fact-check** — claims vs. live web evidence; reuses the shared summary-bar + 3-agent claim list (same component as the main audit page).
- **Citation dossier** — supporting/contradicting source cards per claim.

## Turn meta-states
- **Pending** — spinning accent arc loader + "Pulling your docs and auditing…", left-aligned.
- **Error** — left-aligned bordered card, hallucination-red tint, error message.

## Tokens & system (from the reference `<style>`)
- **Theme + palette** are driven by `data-theme` (`dark`|`light`) and `data-palette` on the root; everything reads `var(--accent)`, `var(--bg-base)`, etc. Never hardcode a color. Keep theme + palette as persisted user settings if your app already has the 7-palette switcher; otherwise default to `dark` + `iris`.
- **Verdict colors** (`--v-verified` / `--v-unverified` / `--v-contradicted` / `--v-hallucination`) are semantically constant; they vary only by dark/light.
- **Type**: Space Grotesk (headings), Geist (UI), Geist Mono (labels, metadata, counts).
- **Motion**: fade + 8px translate-y entrances, `cubic-bezier(.22,1,.36,1)`; spinner for pending; respect `prefers-reduced-motion`.

## Caveat — connector logos
The reference uses **simplified placeholder glyphs** for Notion / Google Drive / Gmail / Slack. Swap in the real brand SVGs (or your existing connector icon set) when you wire up the integrations — do not ship the stand-ins.
