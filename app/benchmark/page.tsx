import type { Metadata } from "next";
import { getBenchmarkView } from "./data";
import { BenchmarkClient } from "./BenchmarkClient";

/**
 * /benchmark — read-only summary of the locked auditor pipeline run
 * across three efficient-tier providers + a live two-prompt comparison
 * surface (OpenAI vs Anthropic only).
 *
 * The heavy `eval/results.json` artifact is imported here in a server
 * component and reduced to a slim `BenchmarkView` before being passed
 * to the client. That keeps the 1.5 MB raw audit trail out of the
 * browser bundle.
 *
 * Per CLAUDE.md "additive only — no changes to existing API routes,
 * lib/ modules, types.ts, or /document". This page reuses /api/chat
 * and /api/audit as-is for its live comparison panel.
 */

export const metadata: Metadata = {
  title: "Groundtruth · Benchmark",
  description:
    "Three-provider hallucination comparison across a labeled 15-prompt test set, with a live two-prompt OpenAI-vs-Anthropic duel.",
};

export default function BenchmarkPage() {
  const view = getBenchmarkView();
  return <BenchmarkClient view={view} />;
}
