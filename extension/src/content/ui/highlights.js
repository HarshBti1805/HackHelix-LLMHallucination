/*
 * Inline verdict highlighting via the CSS Custom Highlight API.
 *
 * Key design choice: we paint highlights over Range objects instead of wrapping
 * text in <span>s. The three target sites are all framework-driven (React /
 * Angular); injecting elements into their message DOM risks breaking their
 * virtual-DOM reconciliation. The Highlight API lets us color arbitrary text
 * ranges purely at the rendering layer, leaving the page DOM untouched.
 *
 * Ranges are grouped by verdict code into named highlights (gt-ok, gt-warn,
 * gt-bad, gt-halluc) plus a transient gt-active used for click-to-locate.
 */
(() => {
  const NS = window.__GROUNDTRUTH;

  const SUPPORTED =
    typeof CSS !== "undefined" &&
    CSS.highlights &&
    typeof Highlight !== "undefined";

  // Severity → highlight priority (higher wins where ranges overlap).
  const PRIORITY = { ok: 1, warn: 2, bad: 3, halluc: 4 };

  // messageId -> { code -> Range[], byClaim: Map<claimId, Range> }
  const byMessage = new Map();
  let activeRange = null;
  let activeTimer = null;

  function buildIndex(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (p && p.closest("script, style, noscript"))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const segments = [];
    let full = "";
    let n;
    while ((n = walker.nextNode())) {
      segments.push({ node: n, start: full.length, len: n.nodeValue.length });
      full += n.nodeValue;
    }
    return { segments, full };
  }

  // Whitespace-insensitive, case-insensitive normalisation that records, for
  // each normalised char, the index of the corresponding char in the original
  // string — so we can map a normalised match back to real text offsets.
  function normalize(full) {
    let norm = "";
    const map = [];
    let prevSpace = true; // start true so leading whitespace is dropped
    for (let i = 0; i < full.length; i++) {
      const c = full[i];
      if (/\s/.test(c)) {
        if (prevSpace) continue;
        norm += " ";
        map.push(i);
        prevSpace = true;
      } else {
        norm += c.toLowerCase();
        map.push(i);
        prevSpace = false;
      }
    }
    return { norm, map };
  }

  function normalizeNeedle(s) {
    return s.replace(/\s+/g, " ").trim().toLowerCase();
  }

  function locate(segments, fullIndex) {
    for (const seg of segments) {
      if (fullIndex >= seg.start && fullIndex <= seg.start + seg.len) {
        return { node: seg.node, offset: fullIndex - seg.start };
      }
    }
    const last = segments[segments.length - 1];
    return last ? { node: last.node, offset: last.len } : null;
  }

  // Find a Range in `root` whose text equals `needle` ignoring whitespace/case.
  function findRange(root, needle) {
    const cleanNeedle = normalizeNeedle(needle);
    if (cleanNeedle.length < 4) return null;
    const { segments, full } = buildIndex(root);
    if (!segments.length) return null;
    const { norm, map } = normalize(full);
    let idx = norm.indexOf(cleanNeedle);
    if (idx === -1) {
      // Retry with a shortened needle (long sentences sometimes differ at the
      // tail due to trailing punctuation/markdown the extractor trimmed).
      const shorter = cleanNeedle.slice(0, Math.max(20, cleanNeedle.length - 15));
      idx = norm.indexOf(shorter);
      if (idx === -1) return null;
      const startOrig = map[idx];
      const endOrig = map[idx + shorter.length - 1] + 1;
      return makeRange(segments, startOrig, endOrig);
    }
    const startOrig = map[idx];
    const endOrig = map[idx + cleanNeedle.length - 1] + 1;
    return makeRange(segments, startOrig, endOrig);
  }

  function makeRange(segments, startOrig, endOrig) {
    const startLoc = locate(segments, startOrig);
    const endLoc = locate(segments, endOrig);
    if (!startLoc || !endLoc) return null;
    try {
      const range = document.createRange();
      range.setStart(startLoc.node, startLoc.offset);
      range.setEnd(endLoc.node, endLoc.offset);
      return range;
    } catch {
      return null;
    }
  }

  function flush() {
    if (!SUPPORTED) return;
    const buckets = { ok: [], warn: [], bad: [], halluc: [] };
    for (const rec of byMessage.values()) {
      for (const code of Object.keys(buckets)) {
        if (rec[code]) buckets[code].push(...rec[code]);
      }
    }
    for (const code of Object.keys(buckets)) {
      const name = `gt-${code}`;
      if (buckets[code].length) {
        const hl = new Highlight(...buckets[code]);
        hl.priority = PRIORITY[code];
        CSS.highlights.set(name, hl);
      } else {
        CSS.highlights.delete(name);
      }
    }
    // Re-apply the active highlight on top.
    if (activeRange) {
      const hl = new Highlight(activeRange);
      hl.priority = 10;
      CSS.highlights.set("gt-active", hl);
    } else {
      CSS.highlights.delete("gt-active");
    }
  }

  NS.highlights = {
    supported: SUPPORTED,

    // Build and register highlights for one message's audit. Returns a Map of
    // claimId -> Range so the panel can scroll to a claim on click.
    setForMessage(messageId, rootEl, claimAudits) {
      if (!SUPPORTED || !rootEl) return new Map();
      const rec = { ok: [], warn: [], bad: [], halluc: [], byClaim: new Map() };
      // Sort so more-severe verdicts are added last (their range still wins via
      // priority, but this keeps per-claim mapping deterministic).
      for (const ca of claimAudits) {
        const meta = NS.VERDICTS[ca.consensus_verdict];
        if (!meta) continue;
        const sentence = (ca.claim && ca.claim.sentence) || ca.claim?.text;
        if (!sentence) continue;
        const range = findRange(rootEl, sentence);
        if (!range) continue;
        rec[meta.code].push(range);
        rec.byClaim.set(ca.claim.id, range);
      }
      byMessage.set(messageId, rec);
      flush();
      return rec.byClaim;
    },

    clearMessage(messageId) {
      byMessage.delete(messageId);
      flush();
    },

    clearAll() {
      byMessage.clear();
      activeRange = null;
      flush();
    },

    // Briefly emphasise + scroll to a specific claim's range.
    flashClaim(messageId, claimId) {
      const rec = byMessage.get(messageId);
      if (!rec) return;
      const range = rec.byClaim.get(claimId);
      if (!range) return;
      activeRange = range;
      flush();
      const node =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer
          : range.startContainer.parentElement;
      if (node && node.scrollIntoView) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (activeTimer) clearTimeout(activeTimer);
      activeTimer = setTimeout(() => {
        activeRange = null;
        flush();
      }, 2200);
    },
  };
})();
