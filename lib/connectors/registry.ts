import * as notion from "@/lib/connectors/notion";
import * as google from "@/lib/connectors/google";
import * as gmail from "@/lib/connectors/gmail";
import * as slack from "@/lib/connectors/slack";
import type {
  ConnectorId,
  ConnectorPageRef,
  ConnectorPageTextResponse,
} from "@/types";

/**
 * Connector registry (MAJOR_CHANGES.md #C1).
 *
 * The single place that maps a `ConnectorId` to its text-pulling operations, so
 * the workspace orchestrator and the API routes never hardcode a provider. Each
 * connector module (`notion.ts`, `google.ts`) exposes the same four functions;
 * this binds them behind one interface. Adding a connector = add a module + one
 * entry here.
 *
 * Connectors only fetch text — they never audit (same separation as
 * `lib/search.ts` vs `lib/agents.ts`).
 */

export interface SourceConnector {
  id: ConnectorId;
  /** Human label for UI + report provenance. */
  label: string;
  isConnected(sid: string): boolean;
  connectedAccount(sid: string): string | undefined;
  searchPages(sid: string, query: string): Promise<ConnectorPageRef[]>;
  fetchPageText(sid: string, id: string): Promise<ConnectorPageTextResponse>;
}

export const CONNECTORS: Record<ConnectorId, SourceConnector> = {
  notion: {
    id: "notion",
    label: "Notion",
    isConnected: notion.isConnected,
    connectedAccount: notion.connectedAccount,
    searchPages: notion.searchPages,
    fetchPageText: notion.fetchPageText,
  },
  google: {
    id: "google",
    label: "Google Drive",
    isConnected: google.isConnected,
    connectedAccount: google.connectedAccount,
    searchPages: google.searchPages,
    fetchPageText: google.fetchPageText,
  },
  gmail: {
    id: "gmail",
    label: "Gmail",
    isConnected: gmail.isConnected,
    connectedAccount: gmail.connectedAccount,
    searchPages: gmail.searchPages,
    fetchPageText: gmail.fetchPageText,
  },
  slack: {
    id: "slack",
    label: "Slack",
    isConnected: slack.isConnected,
    connectedAccount: slack.connectedAccount,
    searchPages: slack.searchPages,
    fetchPageText: slack.fetchPageText,
  },
};

export function getConnector(id: ConnectorId): SourceConnector {
  return CONNECTORS[id];
}

export function connectedConnectors(sid: string): SourceConnector[] {
  return Object.values(CONNECTORS).filter((c) => c.isConnected(sid));
}
