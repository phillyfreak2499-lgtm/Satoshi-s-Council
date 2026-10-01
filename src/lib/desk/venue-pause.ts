import { VENUE_PAUSE_REGISTRATION } from "./venue-pause-registration.ts";

export type ClassificationRow = {
  close_ms: number;
  manifest_sha256: string;
  record: unknown;
  owner_approval_id: string;
  integrity_effect: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Exact evidence + an explicit approved integrity effect; never just a date. */
export function partitionApprovedGaps(holes: readonly number[], rows: readonly ClassificationRow[]) {
  const approved = new Set<number>();
  for (const row of rows) {
    const expected = VENUE_PAUSE_REGISTRATION.entries.find((e) => e.close_ms === Number(row.close_ms));
    if (expected && row.manifest_sha256 === VENUE_PAUSE_REGISTRATION.manifest_sha256 &&
        typeof row.owner_approval_id === "string" && row.owner_approval_id.trim().length > 0 &&
        row.integrity_effect === "EXCLUDE_FROM_MISSING_CONTRACT_COUNT" && canonical(row.record) === canonical(expected)) {
      approved.add(expected.close_ms);
    }
  }
  return { raw: [...holes], classified: holes.filter((h) => approved.has(h)), unresolved: holes.filter((h) => !approved.has(h)) };
}

type ReadDb = { query<T>(text: string, params?: unknown[]): Promise<T[]> };

/** No DDL, INSERT, boot seed, migration or approval inference. Absent = inactive. */
export async function readApprovedGaps(db: ReadDb, holes: readonly number[]) {
  const found = await db.query<{ present: boolean }>("select to_regclass('public.desk_window_classifications') is not null as present");
  if (!found[0]?.present) return partitionApprovedGaps(holes, []);
  const rows = await db.query<ClassificationRow>(
    "select close_ms, manifest_sha256, record, owner_approval_id, integrity_effect from public.desk_window_classifications where manifest_sha256 = $1",
    [VENUE_PAUSE_REGISTRATION.manifest_sha256],
  );
  return partitionApprovedGaps(holes, rows);
}
