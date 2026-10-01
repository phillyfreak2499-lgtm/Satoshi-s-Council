export type PushEventKind = "call" | "read" | "settle" | "watchdog" | "test";
export type PushDeliveryOutcome = "accepted" | "gone" | "failed";

export type PushReceiptInput = {
  eventKind: PushEventKind;
  eventKey: string;
  subscriptionId: number;
  outcome: PushDeliveryOutcome;
  providerStatus?: number | null;
  errorCode?: string | null;
  buildSha?: string | null;
  attemptedAtMs: number;
};

export type PushReceipt = {
  event_kind: PushEventKind;
  event_key: string;
  subscription_id: number;
  outcome: PushDeliveryOutcome;
  provider_status: number | null;
  error_code: string | null;
  build_sha: string;
  attempted_at: string;
};

/** Bound the non-secret receipt fields before they reach durable storage. */
export function pushReceipt(input: PushReceiptInput): PushReceipt {
  const eventKey = input.eventKey.trim().slice(0, 300) || "unknown";
  const status = input.providerStatus;
  return {
    event_kind: input.eventKind,
    event_key: eventKey,
    subscription_id: Math.max(0, Math.trunc(input.subscriptionId)),
    outcome: input.outcome,
    provider_status: typeof status === "number" && Number.isFinite(status) ? Math.trunc(status) : null,
    error_code: input.errorCode ? String(input.errorCode).slice(0, 120) : null,
    build_sha: String(input.buildSha ?? "").slice(0, 80),
    attempted_at: new Date(input.attemptedAtMs).toISOString(),
  };
}

export type PushDeliverySummary = {
  accepted_24h: number;
  /** Provider-accepted call/test receipt for a currently eligible owner call subscriber. */
  call_ready_accepted_24h: number;
  failed_24h: number;
  gone_24h: number;
  last_event_kind: PushEventKind | null;
  last_event_key: string | null;
  last_outcome: PushDeliveryOutcome | null;
  last_attempted_at: string | null;
};

/** Provider acceptance is evidence, not proof that a person saw or acted. */
export function pushDeliveryNote(summary: PushDeliverySummary | null): string {
  if (!summary?.last_attempted_at) return "no durable push attempt receipt yet";
  if (summary.last_outcome === "accepted") {
    return "push service accepted the latest attempt; device display and human receipt are not guaranteed";
  }
  if (summary.last_outcome === "gone") return "the latest push subscription was expired and removed";
  return "the latest push attempt failed before provider acceptance";
}
