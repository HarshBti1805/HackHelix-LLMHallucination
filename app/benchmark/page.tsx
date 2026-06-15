import type { Metadata } from "next";
import { getBenchmarkView } from "./data";
import { BenchmarkClient } from "./BenchmarkClient";

/**
 * /benchmark — an interactive "run your own benchmark" tool on top of the
 * published reference eval.
 *
 * The interactive section lets the user select any number of built-in or
 * custom prompts and run them across any subset of the three chat providers,
 * scoring each response with the locked OpenAI auditor via the existing
 * /api/chat + /api/audit routes (no new endpoints).
 *
 * The heavy `eval/results.json` artifact is imported here in a server
 * component and reduced to a slim `BenchmarkView` before being passed to the
 * client — that keeps the ~1.5 MB raw audit trail out of the browser bundle
 * and powers the published reference table below the tool.
 *
 * Per CLAUDE.md "additive only — no changes to existing API routes, lib/
 * modules, types.ts, or /document".
 */

export const metadata: Metadata = {
  title: "Groundtruth · Benchmark",
  description:
    "Run your own LLM hallucination benchmark: pick or write prompts, choose any providers, and score every response with the locked OpenAI auditor.",
};

export default function BenchmarkPage() {
  const view = getBenchmarkView();
  return <BenchmarkClient view={view} />;
}
