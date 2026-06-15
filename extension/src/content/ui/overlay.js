/*
 * Groundtruth in-page overlay — Iris dark palette, matches the reference design.
 *
 * Three surfaces:
 *   1. Launcher  — 300px card (bottom-right). Shows Start / active status + Stop.
 *   2. Badges    — compact verdict chip anchored top-right of each assistant response.
 *   3. Popover   — per-claim breakdown; opens on badge hover/click.
 */
(() => {
  const NS = window.__GROUNDTRUTH;
  const T  = NS.THEME;

  /* ── shared SVG mark (3-node triangulation) ── */
  const LOGO_SVG = `<svg width="17" height="17" viewBox="0 0 26 26" fill="none">
    <circle cx="13" cy="4.6"  r="2" fill="#f8843a"/>
    <circle cx="5.7" cy="17.5" r="2" fill="${T.accent}"/>
    <circle cx="20.3" cy="17.5" r="2" fill="#2dd4bf"/>
    <circle cx="13"  cy="13"   r="2.4" fill="${T.fg}"/>
  </svg>`;

  const LOGO_SVG_LG = `<svg width="17" height="17" viewBox="0 0 26 26" fill="none">
    <circle cx="13" cy="4.6"  r="2" fill="#f8843a"/>
    <circle cx="5.7" cy="17.5" r="2" fill="${T.accent}"/>
    <circle cx="20.3" cy="17.5" r="2" fill="#2dd4bf"/>
    <circle cx="13"  cy="13"   r="2.4" fill="${T.fg}"/>
  </svg>`;

  /* ── spinner SVG ── */
  const SPIN_SVG = `<svg width="13" height="13" viewBox="0 0 14 14" style="animation:gt-spin .9s linear infinite">
    <circle cx="7" cy="7" r="5.2" stroke="${T.border}" stroke-width="1.6" fill="none"/>
    <path d="M7 1.8 A5.2 5.2 0 0 1 12.2 7" stroke="${T.accent}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }

    @keyframes gt-spin    { to { transform: rotate(360deg); } }
    @keyframes gt-claimin { 0%{opacity:0;transform:translateY(8px)} 100%{opacity:1;transform:translateY(0)} }
    @keyframes gt-pop     { 0%{transform:scale(.55);opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
    @keyframes gt-glow    { 0%,100%{opacity:.55} 50%{opacity:1} }

    .layer { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; overflow: hidden; }
    .layer > * { pointer-events: auto; }

    /* ━━━ BADGE ━━━ */
    .badge {
      position: fixed; display: inline-flex; align-items: center; gap: 7px;
      height: 30px; padding: 0 9px 0 12px; border-radius: 999px; cursor: pointer;
      background: ${T.surface}; color: ${T.fg};
      border: 1px solid ${T.border}; box-shadow: 0 6px 20px rgba(0,0,0,.3);
      font-size: 12px; font-weight: 600; user-select: none;
      transition: transform .12s ease, box-shadow .12s ease;
      will-change: top, left;
    }
    .badge:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,.4); }
    .badge .bdot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .badge .blab { line-height: 1; }
    .badge .bext { display: grid; place-items: center; color: ${T.fgMuted}; margin-left: -2px; }
    .badge .bext svg { width: 11px; height: 11px; }
    .badge.pending { color: ${T.fgMuted}; padding-left: 9px; }

    /* ━━━ POPOVER ━━━ */
    .pop {
      position: fixed; width: 372px; max-width: 94vw; max-height: 74vh;
      display: none; flex-direction: column;
      background: ${T.surface}; color: ${T.fg};
      border: 1px solid rgba(255,255,255,0.17); border-radius: 14px; overflow: hidden;
      box-shadow: 0 30px 70px rgba(0,0,0,.55), 0 2px 0 rgba(255,255,255,0.05) inset;
      z-index: 2147483647; animation: gt-claimin .18s ease both;
    }
    .pop.show { display: flex; }

    .pop-head {
      flex: none; display: flex; align-items: center; gap: 10px;
      padding: 13px 14px; border-bottom: 1px solid ${T.border};
      background: ${T.surfaceMuted};
    }
    .pop-head .logo-wrap {
      width: 30px; height: 30px; border-radius: 9px;
      background: ${T.surface}; border: 1px solid ${T.border};
      display: grid; place-items: center; flex: none;
    }
    .pop-head .brand { flex: 1; min-width: 0; }
    .pop-head .brand .t { font-size: 13.5px; font-weight: 600; letter-spacing: -.01em; color: ${T.fg}; }
    .pop-head .brand .s { font-size: 9px; letter-spacing: .07em; text-transform: uppercase; color: ${T.fgMuted}; margin-top: 1px; font-family: ui-monospace, monospace; }
    .pop-ico { background: transparent; border: 1px solid ${T.border}; color: ${T.fgMuted}; cursor: pointer; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; flex: none; }
    .pop-ico:hover { background: ${T.surface}; color: ${T.fg}; }
    .pop-ico svg { width: 10px; height: 10px; }

    /* summary chips row */
    .pop-chips {
      flex: none; display: flex; gap: 6px; flex-wrap: wrap;
      padding: 11px 13px; border-bottom: 1px solid ${T.border};
    }
    .chip {
      display: inline-flex; align-items: center; gap: 5px;
      height: 22px; padding: 0 9px; border-radius: 999px;
      font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    .chip .cdot { width: 7px; height: 7px; border-radius: 50%; flex: none; }

    /* scrollable claims */
    .pop-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 9px; display: flex; flex-direction: column; gap: 7px; }

    /* claim row */
    .claim {
      border: 1px solid ${T.border}; border-radius: 9px;
      background: ${T.surfaceMuted}; overflow: hidden;
    }
    .claim-row {
      display: flex; align-items: center; gap: 9px;
      padding: 9px 11px; cursor: pointer;
    }
    .claim-row:hover { background: rgba(255,255,255,.04); }
    .claim-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .claim-text {
      flex: 1; min-width: 0; font-family: ui-monospace, monospace;
      font-size: 11px; color: ${T.fg};
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .claim-conf { font-family: ui-monospace, monospace; font-size: 10px; color: ${T.fgMuted}; flex: none; }
    .claim-chev { font-size: 14px; color: ${T.fgMuted}; flex: none; font-family: ui-monospace, monospace; }

    /* expanded claim detail */
    .claim-detail { padding: 0 11px 10px; border-top: 1px solid ${T.border}; display: flex; flex-direction: column; gap: 6px; }
    .agent-row { display: flex; gap: 7px; font-size: 11px; line-height: 1.4; }
    .agent-role { font-family: ui-monospace, monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; flex: none; width: 62px; margin-top: 1px; }
    .agent-text { color: ${T.fgMuted}; flex: 1; }
    .agent-src a { color: ${T.accent}; font-size: 10px; text-decoration: none; }
    .agent-src a:hover { text-decoration: underline; }

    /* error state */
    .pop-err { padding: 14px; font-size: 12px; color: #fb5070; }
    .status-line { font-size: 12px; color: ${T.fgMuted}; padding: 12px 14px; }

    /* footer actions */
    .pop-actions {
      flex: none; padding: 11px 13px;
      border-top: 1px solid ${T.border};
    }
    .btn-primary {
      display: flex; align-items: center; justify-content: center; gap: 7px;
      width: 100%; height: 36px; border-radius: 9px; border: none; cursor: pointer;
      background: ${T.accent}; color: #fff; font-size: 12.5px; font-weight: 600;
    }
    .btn-primary:hover { background: ${T.accentHover}; }
    .btn-primary:disabled { opacity: .6; cursor: default; }
    .btn-primary svg { width: 13px; height: 13px; }

    /* ━━━ LAUNCHER ━━━ */
    .launcher {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      width: 340px; max-width: 92vw;
      background: ${T.surface}; color: ${T.fg};
      border: 1px solid rgba(255,255,255,0.17); border-radius: 14px;
      box-shadow: 0 18px 48px rgba(0,0,0,.55), 0 2px 0 rgba(255,255,255,0.05) inset;
      overflow: hidden; display: none;
    }
    .launcher.show { display: block; animation: gt-claimin .2s ease both; }

    /* launcher header */
    .l-head {
      display: flex; align-items: center; gap: 11px;
      padding: 16px 17px; border-bottom: 1px solid ${T.border};
      background: ${T.surfaceMuted};
    }
    .l-logo {
      width: 30px; height: 30px; border-radius: 9px;
      background: ${T.surface}; border: 1px solid ${T.border};
      display: grid; place-items: center; flex: none;
    }
    .l-brand .t { font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
    .l-brand .s { font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; color: ${T.fgMuted}; margin-top: 1px; }

    /* launcher body */
    .l-body { padding: 15px 17px; }

    .l-status { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 13px; }
    .l-live { width: 8px; height: 8px; border-radius: 50%; background: #34c77b; box-shadow: 0 0 0 3px rgba(52,199,123,.2); flex: none; animation: gt-glow 1.6s ease-in-out infinite; }
    .l-live.off { background: ${T.fgMuted}; box-shadow: none; animation: none; }

    /* last audit info box */
    .l-info {
      display: flex; align-items: center; justify-content: space-between;
      padding: 11px 13px; border-radius: 9px;
      background: ${T.surfaceMuted}; border: 1px solid ${T.border};
      margin-bottom: 14px;
    }
    .l-info .lbl { font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: ${T.fgMuted}; margin-bottom: 3px; }
    .l-info .val { font-size: 13px; color: ${T.fg}; }
    .l-info a { font-family: ui-monospace, monospace; font-size: 11px; color: ${T.accent}; text-decoration: none; display: flex; align-items: center; gap: 3px; }
    .l-info a:hover { text-decoration: underline; }

    .l-row { display: flex; gap: 9px; }
    .l-row .btn-primary { flex: 1; }
    .btn-ghost {
      height: 40px; padding: 0 16px; border-radius: 10px;
      border: 1px solid ${T.border}; background: transparent;
      color: ${T.fgMuted}; font-size: 13px; cursor: pointer;
    }
    .btn-ghost:hover { border-color: rgba(255,255,255,0.17); color: ${T.fg}; }
    .btn-start {
      display: flex; align-items: center; justify-content: center; gap: 7px;
      width: 100%; height: 40px; border-radius: 10px; border: none; cursor: pointer;
      background: ${T.accent}; color: #fff; font-size: 13.5px; font-weight: 600;
      margin-bottom: 0;
    }
    .btn-start:hover { background: ${T.accentHover}; }

    /* launcher footer */
    .l-foot {
      padding: 11px 17px; border-top: 1px solid ${T.border};
      background: ${T.surfaceMuted};
      font-family: ui-monospace, monospace; font-size: 10px; color: ${T.fgMuted};
    }

    /* settings section inside launcher */
    .l-settings { padding: 0 17px 15px; }
    .l-settings .lbl { font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: ${T.fgMuted}; margin-bottom: 8px; }
    .l-url-box {
      display: flex; align-items: center; height: 34px; padding: 0 11px;
      border-radius: 9px; background: ${T.surfaceMuted}; border: 1px solid ${T.border};
      font-family: ui-monospace, monospace; font-size: 11.5px; color: ${T.fgMuted};
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* ━━━ TOAST ━━━ */
    .toast {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      background: ${T.surface}; color: ${T.fg};
      border: 1px solid ${T.border}; border-radius: 12px;
      padding: 11px 14px; font-size: 12.5px;
      box-shadow: 0 10px 30px rgba(0,0,0,.5); max-width: 360px;
      opacity: 0; transform: translateY(8px);
      transition: all .2s ease; pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.err  { background: #fb5070; color: #fff; border-color: #fb5070; }
  `;

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function worstOf(summary) {
    if (summary.likely_hallucination) return "likely_hallucination";
    if (summary.contradicted)          return "contradicted";
    if (summary.unverified_plausible)  return "unverified_plausible";
    return "verified";
  }

  function hexA(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  const Overlay = {
    handlers: {}, started: false, apiBase: "", adapterLabel: "",
    badges: new Map(), activeId: null, pinned: false,
    _closeTimer: null, _rafQueued: false, _expanded: {},

    init(adapterLabel, handlers) {
      if (this.root) return;
      this.adapterLabel = adapterLabel;
      this.handlers = handlers || {};

      this.root = document.createElement("div");
      this.root.id = "groundtruth-root";
      this.shadow = this.root.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS;
      this.shadow.appendChild(style);

      this.layer    = el(`<div class="layer"></div>`);
      this.pop      = el(`<div class="pop"></div>`);
      this.launcher = el(`<div class="launcher"></div>`);
      this.toastEl  = el(`<div class="toast"></div>`);

      this.layer.appendChild(this.pop);
      this.pop.addEventListener("mouseenter", () => this._cancelClose());
      this.pop.addEventListener("mouseleave", () => this._scheduleClose());

      this.shadow.appendChild(this.layer);
      this.shadow.appendChild(this.launcher);
      this.shadow.appendChild(this.toastEl);
      document.documentElement.appendChild(this.root);

      this._renderLauncher();

      window.addEventListener("scroll", () => this.reposition(), true);
      window.addEventListener("resize", () => this.reposition(), true);

      document.addEventListener("mousedown", (e) => {
        if (!this.pinned) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (path.includes(this.pop)) return;
        if (this.activeId && this.badges.get(this.activeId) && path.includes(this.badges.get(this.activeId).el)) return;
        this._closePopover();
      }, true);
    },

    setApiBase(base) { this.apiBase = base || ""; },

    /* ── launcher ── */
    toggleLauncher() { this.launcher.classList.toggle("show"); },
    showLauncher()   { this.launcher.classList.add("show"); },
    hideLauncher()   { this.launcher.classList.remove("show"); },
    setStarted(on)   { this.started = on; this._renderLauncher(); },

    _renderLauncher() {
      const L = this.launcher;
      const apiDisplay = NS.escapeHtml(this.apiBase || "http://localhost:3000");
      const site = NS.escapeHtml(this.adapterLabel);

      if (!this.started) {
        L.innerHTML = `
          <div class="l-head">
            <div class="l-logo">${LOGO_SVG_LG}</div>
            <div class="l-brand">
              <div class="t">Groundtruth</div>
              <div class="s">Multi-agent verifier</div>
            </div>
          </div>
          <div class="l-body">
            <div class="l-status">
              <span class="l-live off"></span>
              <span style="color:${T.fgMuted}">Paused — not auditing</span>
            </div>
            <button class="btn-start">
              <span style="width:7px;height:7px;border-radius:50%;background:#fff;display:inline-block"></span>
              Start Auditing
            </button>
          </div>
          <div class="l-settings">
            <div style="height:1px;background:${T.border};margin-bottom:13px"></div>
            <div class="lbl">Backend URL</div>
            <div class="l-url-box">${apiDisplay}</div>
          </div>
          <div class="l-foot">v1.0.0 · Supports ChatGPT · Claude · Gemini</div>`;

        L.querySelector(".btn-start").addEventListener("click", () => {
          if (this.handlers.onStart) this.handlers.onStart();
          this.hideLauncher();
        });
      } else {
        // figure out last audit summary for the info box
        let lastAuditHtml = `<span style="color:${T.fgMuted}">No audits yet</span>`;
        if (this._lastSummary) {
          const iss = (this._lastSummary.contradicted || 0) + (this._lastSummary.likely_hallucination || 0);
          const total = this._lastSummary.total_claims || 0;
          const issHtml = iss > 0
            ? `<span style="color:#fb5070">${iss} issue${iss > 1 ? "s" : ""}</span>`
            : `<span style="color:#34c77b">no issues</span>`;
          lastAuditHtml = `${total} claim${total !== 1 ? "s" : ""} · ${issHtml}`;
        }

        L.innerHTML = `
          <div class="l-head">
            <div class="l-logo">${LOGO_SVG_LG}</div>
            <div class="l-brand">
              <div class="t">Groundtruth</div>
              <div class="s">Multi-agent verifier</div>
            </div>
          </div>
          <div class="l-body">
            <div class="l-status">
              <span class="l-live"></span>
              <span>Auditing active on ${site}</span>
            </div>
            <div class="l-info">
              <div>
                <div class="lbl">Last audit</div>
                <div class="val">${lastAuditHtml}</div>
              </div>
              <a href="#" class="view-link">View ↗</a>
            </div>
            <div class="l-row">
              <button class="btn-start audit-btn" style="flex:1">
                <span style="width:7px;height:7px;border-radius:50%;background:#fff;display:inline-block"></span>
                Auditing
              </button>
              <button class="btn-ghost stop-btn" style="width:88px">Stop</button>
            </div>
          </div>
          <div class="l-settings">
            <div style="height:1px;background:${T.border};margin-bottom:13px"></div>
            <div class="lbl">Backend URL</div>
            <div class="l-url-box">${apiDisplay}</div>
          </div>
          <div class="l-foot">v1.0.0 · Supports ChatGPT · Claude · Gemini</div>`;

        L.querySelector(".stop-btn").addEventListener("click", () => {
          if (this.handlers.onStop) this.handlers.onStop();
        });
        L.querySelector(".audit-btn").addEventListener("click", () => {
          if (this.handlers.onAuditLatest) this.handlers.onAuditLatest();
        });
        const vl = L.querySelector(".view-link");
        if (vl) vl.addEventListener("click", (e) => {
          e.preventDefault();
          // open the most recent badge popover
          if (this.activeId) this._openPopover(this.activeId, true);
          else {
            const last = [...this.badges.keys()].pop();
            if (last) this._openPopover(last, true);
          }
          this.hideLauncher();
        });
      }
    },

    /* store last summary so the launcher info box can show it */
    _lastSummary: null,
    notifyAuditComplete(summary) {
      this._lastSummary = summary;
      if (this.started) this._renderLauncher();
    },

    /* ── badges ── */
    setBadge(id, anchor, data) {
      let rec = this.badges.get(id);
      if (!rec) {
        const badgeEl = el(`<div class="badge"></div>`);
        badgeEl.addEventListener("mouseenter", () => this._openPopover(id, false));
        badgeEl.addEventListener("mouseleave", () => this._scheduleClose());
        badgeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.activeId === id && this.pinned) this._closePopover();
          else this._openPopover(id, true);
        });
        this.layer.appendChild(badgeEl);
        rec = { anchor, el: badgeEl, data: {} };
        this.badges.set(id, rec);
      }
      rec.anchor = anchor || rec.anchor;
      rec.data = { ...rec.data, ...data };
      this._renderBadge(id);
      this.reposition();
      if (this.activeId === id && this.pop.classList.contains("show")) {
        this._renderPopover(id);
      }
      // notify launcher if audit is done
      if (data && data.state === "done" && data.audit) {
        this.notifyAuditComplete(data.audit.summary);
      }
    },

    removeBadge(id) {
      const rec = this.badges.get(id);
      if (!rec) return;
      rec.el.remove();
      this.badges.delete(id);
      if (this.activeId === id) this._closePopover();
    },

    clearAllBadges() {
      for (const id of [...this.badges.keys()]) this.removeBadge(id);
    },

    _renderBadge(id) {
      const rec = this.badges.get(id);
      if (!rec) return;
      const d = rec.data;
      const badgeEl = rec.el;

      if (d.state === "pending") {
        badgeEl.className = "badge pending";
        badgeEl.innerHTML = `${SPIN_SVG}<span class="blab">Auditing…</span>`;
        badgeEl.title = "Groundtruth is auditing this response…";
        badgeEl.style.borderColor = T.border;
        return;
      }
      if (d.state === "error") {
        badgeEl.className = "badge";
        badgeEl.innerHTML = `<span class="bdot" style="background:${T.fgMuted}"></span><span class="blab">Audit failed</span>`;
        badgeEl.title = d.error || "Audit failed";
        badgeEl.style.borderColor = T.border;
        return;
      }

      const s = d.audit.summary;
      const issues = (s.contradicted || 0) + (s.likely_hallucination || 0);
      const worst = NS.VERDICTS[worstOf(s)];

      badgeEl.className = "badge";

      if (s.total_claims === 0 || issues === 0) {
        badgeEl.innerHTML = `
          <span class="bdot" style="background:#34c77b"></span>
          <span class="blab">Verified</span>`;
        badgeEl.style.borderColor = "rgba(52,199,123,0.45)";
        badgeEl.style.background  = `color-mix(in srgb, #34c77b 16%, ${T.surface})`;
        badgeEl.title = `${s.total_claims} claim${s.total_claims !== 1 ? "s" : ""} checked — all clear`;
      } else {
        badgeEl.innerHTML = `
          <span class="bdot" style="background:${worst.color}"></span>
          <span class="blab">${issues} issue${issues > 1 ? "s" : ""}</span>
          <span class="bext">
            <svg viewBox="0 0 9 9" fill="none" style="opacity:.6">
              <path d="M2.5 2.5H6.5V6.5M6.5 2.5 2.5 6.5" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </span>`;
        badgeEl.style.borderColor = hexA(worst.color, 0.5);
        badgeEl.style.background  = `color-mix(in srgb, ${worst.color} 16%, ${T.surface})`;
        badgeEl.title = `${issues} flagged claim${issues > 1 ? "s" : ""} — click to review`;
      }
    },

    /* ── positioning ── */
    reposition() {
      if (this._rafQueued) return;
      this._rafQueued = true;
      requestAnimationFrame(() => {
        this._rafQueued = false;
        const vw = window.innerWidth, vh = window.innerHeight;
        for (const [, rec] of this.badges) {
          const a = rec.anchor;
          if (!a || !a.isConnected) { rec.el.style.display = "none"; continue; }
          const r = a.getBoundingClientRect();
          if (r.bottom < 0 || r.top > vh || r.width === 0) { rec.el.style.display = "none"; continue; }
          rec.el.style.display = "inline-flex";
          let top  = Math.min(Math.max(r.top + 8, 8), r.bottom - 30);
          top  = Math.min(top, vh - 36);
          let left = Math.min(r.right - 8 - rec.el.offsetWidth, vw - rec.el.offsetWidth - 8);
          left = Math.max(left, 8);
          rec.el.style.top  = `${top}px`;
          rec.el.style.left = `${left}px`;
        }
        if (this.activeId && this.pop.classList.contains("show")) this._positionPopover();
      });
    },

    _positionPopover() {
      const rec = this.badges.get(this.activeId);
      if (!rec) return;
      const b  = rec.el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const pw = this.pop.offsetWidth  || 372;
      const ph = this.pop.offsetHeight || 340;
      let left = b.left - pw - 10;
      if (left < 8) left = Math.min(b.right + 10, vw - pw - 8);
      left = Math.max(8, Math.min(left, vw - pw - 8));
      const top  = Math.max(8, Math.min(b.top, vh - ph - 8));
      this.pop.style.left = `${left}px`;
      this.pop.style.top  = `${top}px`;
    },

    /* ── popover open / close ── */
    _cancelClose() { clearTimeout(this._closeTimer); this._closeTimer = null; },
    _scheduleClose() {
      if (this.pinned) return;
      this._cancelClose();
      this._closeTimer = setTimeout(() => this._closePopover(), 220);
    },
    _openPopover(id, pin) {
      this._cancelClose();
      const rec = this.badges.get(id);
      if (!rec || rec.data.state === "pending") return;
      if (this.activeId && this.activeId !== id && this.handlers.onHide) {
        this.handlers.onHide(this.activeId);
      }
      this.activeId = id;
      this.pinned   = pin || this.pinned;
      this._renderPopover(id);
      this.pop.classList.add("show");
      this._positionPopover();
      requestAnimationFrame(() => this._positionPopover());
      if (this.handlers.onShow) this.handlers.onShow(id);
    },
    _closePopover() {
      this._cancelClose();
      this.pop.classList.remove("show");
      const closed = this.activeId;
      this.activeId = null;
      this.pinned   = false;
      if (closed && this.handlers.onHide) this.handlers.onHide(closed);
    },

    /* ── popover render ── */
    _renderPopover(id) {
      const rec = this.badges.get(id);
      if (!rec) return;
      const d = rec.data;

      const HEAD = `
        <div class="pop-head">
          <div class="logo-wrap">${LOGO_SVG}</div>
          <div class="brand">
            <div class="t">Groundtruth</div>
            <div class="s">Multi-agent verifier</div>
          </div>
          <button class="pop-ico close-btn" title="Close">
            <svg viewBox="0 0 11 11" fill="none"><path d="M2 2 9 9M9 2 2 9" stroke="currentColor" stroke-width="1.3"/></svg>
          </button>
        </div>`;

      if (d.state === "error") {
        this.pop.innerHTML = HEAD +
          `<div class="pop-err">Audit failed: ${NS.escapeHtml(d.error || "unknown error")}</div>
           <div class="pop-actions">
             <button class="btn-primary retry-btn" style="background:${T.surfaceMuted};border:1px solid ${T.border};color:${T.fg}">Retry audit</button>
           </div>`;
        this._wireClose(id);
        const r = this.pop.querySelector(".retry-btn");
        if (r) r.addEventListener("click", () => { if (this.handlers.onRetry) this.handlers.onRetry(id); });
        return;
      }

      const audit = d.audit;
      const s = audit.summary;

      // summary chips
      const chipDefs = [
        { key: "verified",             label: "verified"    },
        { key: "unverified_plausible", label: "unverified"  },
        { key: "contradicted",         label: "contradicted"},
        { key: "likely_hallucination", label: "hallucination"},
      ];
      let chipsHtml = chipDefs
        .filter(c => s[c.key] > 0)
        .map(c => {
          const col = NS.VERDICTS[c.key].color;
          return `<span class="chip" style="background:${hexA(col, 0.16)};color:${T.fg}">
            <span class="cdot" style="background:${col}"></span>
            <b>${s[c.key]}</b> ${c.label}
          </span>`;
        }).join("");
      if (!chipsHtml) chipsHtml = `<span class="chip" style="background:${T.surfaceMuted};color:${T.fgMuted};border:1px solid ${T.border}">no verifiable claims</span>`;

      // claims
      const claimsHtml = (audit.claims || []).map(ca => this._claimHtml(ca)).join("")
        || `<div class="status-line">No atomic claims were extracted from this response.</div>`;

      const flagged = (s.contradicted || 0) + (s.likely_hallucination || 0);
      const actionsHtml = flagged ? `
        <div class="pop-actions">
          <button class="btn-primary dehalluc-btn">
            <svg viewBox="0 0 13 13" fill="none"><rect x="3.5" y="3.5" width="6.8" height="6.8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 7.8V2.5H7.8" stroke="currentColor" stroke-width="1.2"/></svg>
            Copy grounded re-prompt
          </button>
        </div>` : "";

      this.pop.innerHTML = HEAD +
        `<div class="pop-chips">${chipsHtml}</div>` +
        `<div class="pop-body">${claimsHtml}</div>` +
        actionsHtml;

      this._wireClose(id);
      this._wireClaimToggles();

      const dh = this.pop.querySelector(".dehalluc-btn");
      if (dh) dh.addEventListener("click", async () => {
        if (!this.handlers.onDehallucinate) return;
        const orig = dh.innerHTML;
        dh.disabled = true;
        dh.textContent = "Generating grounded prompt…";
        try {
          await this.handlers.onDehallucinate(id);
          dh.textContent = "Copied to clipboard ✓";
          setTimeout(() => { dh.innerHTML = orig; dh.disabled = false; }, 2400);
        } catch (e) {
          dh.innerHTML = orig;
          dh.disabled = false;
          this.toast(e.message || "Dehallucinate failed", true);
        }
      });
    },

    _wireClose(id) {
      const c = this.pop.querySelector(".close-btn");
      if (c) c.addEventListener("click", () => this._closePopover());
    },

    _wireClaimToggles() {
      this.pop.querySelectorAll(".claim-row").forEach(row => {
        row.addEventListener("click", () => {
          const cid = row.dataset.claim;
          const detail = this.pop.querySelector(`.claim-detail[data-claim="${cid}"]`);
          const chev   = row.querySelector(".claim-chev");
          if (!detail) return;
          const open = detail.style.display !== "none";
          detail.style.display = open ? "none" : "flex";
          if (chev) chev.textContent = open ? "+" : "−";
        });
      });
    },

    _claimHtml(ca) {
      const meta = NS.VERDICTS[ca.consensus_verdict] || { label: ca.consensus_verdict, color: T.fgMuted };
      const conf = Math.round((ca.consensus_confidence || 0) * 100);
      const dotGlow = `box-shadow:0 0 8px ${meta.color}`;

      const AGENT_COLORS = {
        prosecutor: "#ef5a6b",
        defender:   T.accent,
        literalist: "#8b93a4",
      };

      const agentsHtml = (ca.per_agent_reports || []).map(r => {
        const am   = NS.VERDICTS[r.verdict] || { label: r.verdict, color: T.fgMuted };
        const role = (r.agent_role || "").toLowerCase();
        const color = AGENT_COLORS[role] || T.fgMuted;
        const firstSrc = (r.sources || [])[0];
        const srcHtml  = firstSrc
          ? `<span class="agent-src" style="margin-top:2px">
               <a href="${NS.escapeHtml(firstSrc.url)}" target="_blank" rel="noreferrer">
                 ${NS.escapeHtml(firstSrc.title || firstSrc.domain || firstSrc.url)}
               </a>
             </span>`
          : "";
        return `<div class="agent-row">
          <span class="agent-role" style="color:${color}">${NS.escapeHtml(role)}</span>
          <span class="agent-text">${NS.escapeHtml(r.reasoning || "")}${srcHtml}</span>
        </div>`;
      }).join("");

      const claimId = NS.escapeHtml(ca.claim.id);
      return `
        <div class="claim">
          <div class="claim-row" data-claim="${claimId}">
            <span class="claim-dot" style="background:${meta.color};${dotGlow}"></span>
            <span class="claim-text">"${NS.escapeHtml(ca.claim.text)}"</span>
            <span class="claim-conf">${conf / 100}</span>
            <span class="claim-chev">+</span>
          </div>
          <div class="claim-detail" data-claim="${claimId}" style="display:none">
            ${agentsHtml}
          </div>
        </div>`;
    },

    /* ── toast ── */
    toast(message, isError) {
      this.toastEl.textContent = message;
      this.toastEl.classList.toggle("err", !!isError);
      this.toastEl.classList.add("show");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 4400);
    },
  };

  NS.overlay = Overlay;
})();
