import type { DocumentRevision } from "@/types";

/**
 * Pure helpers for applying `DocumentRevision[]` to the original source
 * text of an audited document.
 *
 * Used exclusively from the `/document` page's Revisions Review modal — at
 * download time we splice each user-accepted revision into the source text
 * so the downloaded artifact reflects the current accept/reject state.
 *
 * Sentence-matching policy (mirrors `locateClaimSpans` in
 * `components/audit/highlightSpans.ts`):
 *
 *   First-occurrence-not-yet-replaced. For each revision in input order,
 *   scan the source from position 0 forward for the first verbatim
 *   occurrence of `original_sentence` whose span does NOT overlap any
 *   previously claimed span. If no such occurrence exists, the revision
 *   is marked unmatched and excluded from the applied output. The exact
 *   same rule the highlighter uses keeps the downloaded text and the
 *   on-screen highlights in lockstep — a revision that highlights at
 *   position N also splices at position N.
 *
 * Why a single, shared rule rather than fuzzy matching: the extractor
 * (`lib/extract.ts`) copies `claim.sentence` verbatim from the source
 * almost always; verbatim matching has very high recall on real
 * documents. The rare paraphrase miss (e.g. nested quotes that the
 * extractor decided to normalise) is surfaced honestly via the
 * `unmatched` set rather than papered over.
 *
 * Pure / no React imports — kept in `lib/` so this file can be
 * unit-tested in isolation and (in principle) imported from a server
 * component. The modal still renders the result client-side.
 */

export interface RevisionLocation {
  revision: DocumentRevision;
  /** Offset of the first character of `original_sentence` in `sourceText`,
   *  or `null` if the sentence could not be located non-overlappingly. */
  start: number | null;
  end: number | null;
}

export interface RevisionLocationResult {
  /** One entry per input revision, in input order. */
  located: RevisionLocation[];
  /** Set of `claim_id`s whose `original_sentence` could not be matched.
   *  The modal renders an "unmatched" indicator on those cards and the
   *  download routines skip them. */
  unmatched: Set<string>;
}

/**
 * Locate every revision's original sentence in the source text using
 * first-occurrence-not-yet-replaced matching. See file-level docstring
 * for the rationale.
 *
 * Note: the order in which revisions are passed in matters — earlier
 * revisions claim spans first, so two revisions sharing the exact same
 * `original_sentence` (rare, but possible if the extractor pulled the
 * same sentence twice) end up locating to consecutive occurrences in
 * the source. Mirrors `locateClaimSpans`.
 */
export function locateRevisions(
  sourceText: string,
  revisions: DocumentRevision[],
): RevisionLocationResult {
  const located: RevisionLocation[] = [];
  const unmatched = new Set<string>();
  const claimedSpans: { start: number; end: number }[] = [];

  for (const r of revisions) {
    const needle = r.original_sentence;
    if (!needle) {
      unmatched.add(r.claim_id);
      located.push({ revision: r, start: null, end: null });
      continue;
    }

    let cursor = 0;
    let foundAt = -1;
    while (cursor <= sourceText.length) {
      const idx = sourceText.indexOf(needle, cursor);
      if (idx === -1) break;
      const end = idx + needle.length;
      const overlap = claimedSpans.some(
        (s) => !(end <= s.start || idx >= s.end),
      );
      if (!overlap) {
        foundAt = idx;
        break;
      }
      cursor = idx + 1;
    }

    if (foundAt === -1) {
      unmatched.add(r.claim_id);
      located.push({ revision: r, start: null, end: null });
    } else {
      claimedSpans.push({ start: foundAt, end: foundAt + needle.length });
      located.push({
        revision: r,
        start: foundAt,
        end: foundAt + needle.length,
      });
    }
  }

  return { located, unmatched };
}

export interface ApplyResult {
  text: string;
  /** Revisions that were spliced in (located, accepted). */
  appliedClaimIds: string[];
  /** Revisions whose `original_sentence` could not be located in the source.
   *  Surfaced in the modal AND included as a footer note in the change-
   *  markers download. */
  unmatchedClaimIds: string[];
  /** Revisions the user explicitly rejected. Tracked so the change-markers
   *  download can mention how many were skipped. */
  rejectedClaimIds: string[];
}

/**
 * Build the "Revised document" plain-text output:
 *   - For each ACCEPTED revision whose sentence was located, splice the
 *     `replacement_sentence` in place of the original.
 *   - REJECTED revisions leave the original sentence intact.
 *   - UNMATCHED revisions are excluded (paraphrased, can't splice safely).
 *   - All other (non-failed) sentences in the document remain
 *     byte-identical — that's the entire point of the document path.
 *
 * Splices are applied from the END of the document backwards so earlier
 * splice positions don't shift. The locating step always runs against the
 * ORIGINAL text so positions stay stable regardless of replacement length.
 */
export function applyRevisions(
  sourceText: string,
  revisions: DocumentRevision[],
  acceptedClaimIds: ReadonlySet<string>,
): ApplyResult {
  const { located, unmatched } = locateRevisions(sourceText, revisions);

  const rejectedClaimIds: string[] = [];
  const appliedClaimIds: string[] = [];

  // Sort accepted, located splices from rightmost to leftmost so each
  // edit only changes positions to the right of itself, which we no
  // longer care about.
  const splices = located
    .filter((l) => {
      if (acceptedClaimIds.has(l.revision.claim_id)) {
        if (l.start !== null && l.end !== null) {
          appliedClaimIds.push(l.revision.claim_id);
          return true;
        }
      } else {
        rejectedClaimIds.push(l.revision.claim_id);
      }
      return false;
    })
    .sort((a, b) => (b.start ?? 0) - (a.start ?? 0));

  let out = sourceText;
  for (const s of splices) {
    if (s.start === null || s.end === null) continue;
    out =
      out.slice(0, s.start) +
      s.revision.replacement_sentence +
      out.slice(s.end);
  }

  return {
    text: out,
    appliedClaimIds,
    unmatchedClaimIds: Array.from(unmatched),
    rejectedClaimIds,
  };
}

/**
 * Build the "With change markers" markdown output:
 *
 *   <small metadata block>
 *
 *   <intact text up to the first accepted revision>
 *   ~~<original>~~ → <replacement>
 *   <!-- Rationale: <rationale> -->
 *   <intact text> ...
 *
 * Rejected revisions are NOT marked up — the file is meant as a
 * before/after of what the user actually accepted. Unmatched accepted
 * revisions are listed in a footer note so the user knows we couldn't
 * splice them safely.
 *
 * Like `applyRevisions`, splices are applied from the end of the
 * document backwards so positions stay stable.
 */
export function buildChangeMarkersMarkdown(
  sourceText: string,
  revisions: DocumentRevision[],
  acceptedClaimIds: ReadonlySet<string>,
  meta: { filename: string; generatedAt: Date },
): string {
  const { located, unmatched } = locateRevisions(sourceText, revisions);

  const splices: {
    start: number;
    end: number;
    revision: DocumentRevision;
  }[] = [];
  const rejected: DocumentRevision[] = [];
  const acceptedButUnmatched: DocumentRevision[] = [];

  for (const l of located) {
    const accepted = acceptedClaimIds.has(l.revision.claim_id);
    if (!accepted) {
      rejected.push(l.revision);
      continue;
    }
    if (l.start === null || l.end === null) {
      acceptedButUnmatched.push(l.revision);
      continue;
    }
    splices.push({ start: l.start, end: l.end, revision: l.revision });
  }

  splices.sort((a, b) => b.start - a.start);

  let body = sourceText;
  for (const s of splices) {
    const block =
      `~~${s.revision.original_sentence}~~ → ${s.revision.replacement_sentence}\n` +
      `<!-- Rationale: ${escapeForHtmlComment(s.revision.rationale)} -->`;
    body = body.slice(0, s.start) + block + body.slice(s.end);
  }

  const ts = meta.generatedAt.toISOString();
  const header =
    `<!--\n` +
    `Groundtruth — Document with change markers\n` +
    `Filename: ${meta.filename}\n` +
    `Generated: ${ts}\n` +
    `Revisions applied: ${splices.length}\n` +
    `Revisions rejected: ${rejected.length}\n` +
    (acceptedButUnmatched.length > 0
      ? `Revisions accepted but unmatched: ${acceptedButUnmatched.length}\n`
      : "") +
    `-->\n\n`;

  let footer = "";
  if (acceptedButUnmatched.length > 0) {
    footer += `\n\n---\n\n## Unmatched revisions\n\n`;
    footer +=
      `These revisions were accepted, but their original sentences could ` +
      `not be located verbatim in the source (the auditor may have ` +
      `paraphrased them) and so they are not spliced into the body above:\n\n`;
    for (const r of acceptedButUnmatched) {
      footer +=
        `- **${r.claim_id}** — original: \`${truncate(r.original_sentence, 160)}\`\n` +
        `  - replacement: ${r.replacement_sentence}\n` +
        `  - rationale: ${r.rationale}\n`;
    }
  }

  return header + body + footer;
}

function escapeForHtmlComment(s: string): string {
  // HTML comments cannot contain "--". Replacing with an em-dash keeps the
  // rationale human-readable and avoids closing the comment prematurely.
  return s.replace(/--/g, "—");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
