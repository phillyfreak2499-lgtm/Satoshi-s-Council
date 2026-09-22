import { createServerFn } from "@tanstack/react-start";
import { cleanBoardBody, privateBoardContactKind } from "./public-room-view";
import { assertPublicBoardWho } from "./system-events";

export type BoardKind = "idea" | "feedback" | "update";

export type BoardPost = {
  id: number;
  who: string;
  body: string;
  kind: BoardKind;
  parent_id: number | null;
  lean: string;
  ticker: string;
  conf: number;
  t: number;
};

function clean(s: unknown, max: number) {
  return String(s ?? "")
    // Control characters are exactly what this is for: board text arrives from
    // posts and titles and must not carry them through to the page.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function asPost(row: {
  id: number;
  who: string;
  body: string;
  kind?: string | null;
  parent_id?: number | null;
  lean: string;
  ticker: string;
  conf: number;
  created_at: string | Date | number;
}): BoardPost {
  const t =
    typeof row.created_at === "number"
      ? row.created_at
      : new Date(row.created_at).getTime();
  const parent = row.parent_id == null ? null : Number(row.parent_id);
  return {
    id: Number(row.id),
    who: row.who,
    body: row.body,
    kind:
      parent != null ? "feedback" : row.kind === "update" ? "update" : row.kind === "feedback" ? "feedback" : "idea",
    parent_id: Number.isFinite(parent as number) ? parent : null,
    lean: row.lean,
    ticker: row.ticker,
    conf: Number(row.conf) || 0,
    t: Number.isFinite(t) ? t : Date.now(),
  };
}

/** The visible Board, oldest first. Server only; the server function and the route loader both read through here. */
export async function readBoard(): Promise<BoardPost[]> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    who: string;
    body: string;
    kind: string;
    parent_id: number | null;
    lean: string;
    ticker: string;
    conf: number;
    created_at: string | Date;
  }>`select id, who, body, kind, parent_id, lean, ticker, conf, created_at from board b where not b.hidden and not exists (select 1 from board parent where parent.id = b.parent_id and parent.hidden) order by id desc limit 120`;
  return rows.map(asPost).reverse();
}

export const listBoard = createServerFn({ method: "GET" }).handler(async () => readBoard());

export const postBoard = createServerFn({ method: "POST" })
  .validator(
    (data: {
      who: string;
      body: string;
      kind?: BoardKind;
      parent_id?: number | null;
      lean?: string;
      ticker?: string;
      conf?: number;
      admin_key?: string;
      website?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    if (data.website) throw new Error("Could not accept this post.");
    const who = clean(data.who, 24) || "anon";
    const body = cleanBoardBody(data.body);
    if (!body) throw new Error("Write a note first.");
    const parent = data.parent_id && data.parent_id > 0 ? Math.round(data.parent_id) : null;
    let kind: BoardKind = parent || data.kind === "feedback" ? "feedback" : "idea";
    let systemUpdate = false;
    if (!parent && data.kind === "update") {
      const { adminKeyOk } = await import("./admin.server");
      if (!adminKeyOk(data.admin_key)) throw new Error("Updates are desk-admin only.");
      kind = "update";
      systemUpdate = true;
    }
    assertPublicBoardWho(who, systemUpdate);
    const privateContact = !parent && !systemUpdate ? privateBoardContactKind(body) : null;
    const privateReason = privateContact ? `private contact: ${privateContact}` : null;
    const lean = clean(data.lean, 8);
    const ticker = clean(data.ticker, 48);
    const conf = Math.max(0, Math.min(100, Math.round(Number(data.conf) || 0)));
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (parent) {
      const found = await sql<{ id: number }>`select id from board where id = ${parent} and not hidden and parent_id is null limit 1`;
      if (!found[0]) throw new Error("That idea is gone.");
    }
    if (!systemUpdate) {
      const { requestNetworkKey, reserveBoardPost } = await import("./board-controls.server");
      await reserveBoardPost(sql, await requestNetworkKey());
    }
    const rows = await sql<{
      id: number;
      who: string;
      body: string;
      kind: string;
      parent_id: number | null;
      lean: string;
      ticker: string;
      conf: number;
      created_at: string | Date;
    }>`
      with inserted as (
        insert into board (who, body, kind, parent_id, lean, ticker, conf, hidden, moderation_reason)
        values (${who}, ${body}, ${kind}, ${parent}, ${lean}, ${ticker}, ${conf}, ${privateContact != null}, ${privateReason})
        returning id, who, body, kind, parent_id, lean, ticker, conf, created_at
      ),
      logged as (
        insert into board_moderation_log (board_id, hidden, reason)
        select id, true, ${privateReason} from inserted where ${privateContact != null}
      )
      select id, who, body, kind, parent_id, lean, ticker, conf, created_at from inserted
    `;
    return asPost(rows[0]!);
  });


export type ModerationPost = BoardPost & { hidden: boolean; moderation_reason: string | null };

export const listBoardModeration = createServerFn({ method: "POST" })
  .validator((data: { admin_key: string }) => data)
  .handler(async ({ data }): Promise<ModerationPost[]> => {
    const { adminKeyOk } = await import("./admin.server");
    if (!adminKeyOk(data.admin_key)) throw new Error("Board moderation is desk-admin only.");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<Parameters<typeof asPost>[0] & { hidden: boolean; moderation_reason: string | null }>`
      select id, who, body, kind, parent_id, lean, ticker, conf, created_at, hidden, moderation_reason
      from board order by id desc limit 120
    `;
    return rows.map((row) => ({ ...asPost(row), hidden: row.hidden, moderation_reason: row.moderation_reason }));
  });

export const moderateBoard = createServerFn({ method: "POST" })
  .validator((data: { admin_key: string; id: number; hidden: boolean; reason: string }) => data)
  .handler(async ({ data }) => {
    const { adminKeyOk } = await import("./admin.server");
    if (!adminKeyOk(data.admin_key)) throw new Error("Board moderation is desk-admin only.");
    const reason = clean(data.reason, 200);
    if (!Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.hidden !== "boolean" || !reason) throw new Error("Choose a post and enter a moderation reason.");
    const { getSql } = await import("@/lib/db");
    const { setBoardVisibility } = await import("./board-controls.server");
    await setBoardVisibility(await getSql(), data.id, data.hidden, reason);
    return { ok: true };
  });
