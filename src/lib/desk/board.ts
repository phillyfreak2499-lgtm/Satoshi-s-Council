import { createServerFn } from "@tanstack/react-start";

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

export const listBoard = createServerFn({ method: "GET" }).handler(async () => {
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
  }>`select id, who, body, kind, parent_id, lean, ticker, conf, created_at from board order by id desc limit 120`;
  return rows.map(asPost).reverse();
});

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
    }) => data,
  )
  .handler(async ({ data }) => {
    const who = clean(data.who, 24) || "anon";
    const body = clean(data.body, 400);
    if (!body) throw new Error("Write a note first.");
    const parent = data.parent_id && data.parent_id > 0 ? Math.round(data.parent_id) : null;
    let kind: BoardKind = parent || data.kind === "feedback" ? "feedback" : "idea";
    if (!parent && data.kind === "update") {
      const { adminKeyOk } = await import("./admin.server");
      if (!adminKeyOk(data.admin_key)) throw new Error("Updates are desk-admin only.");
      kind = "update";
    }
    const lean = clean(data.lean, 8);
    const ticker = clean(data.ticker, 48);
    const conf = Math.max(0, Math.min(100, Math.round(Number(data.conf) || 0)));
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const recent = await sql<{ created_at: string | Date }>`
      select created_at from board where who = ${who} order by id desc limit 1
    `;
    if (recent[0]) {
      const last = new Date(recent[0].created_at).getTime();
      if (Date.now() - last < 8000) throw new Error("Wait a few seconds.");
    }
    if (parent) {
      const found = await sql<{ id: number }>`select id from board where id = ${parent} limit 1`;
      if (!found[0]) throw new Error("That idea is gone.");
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
      insert into board (who, body, kind, parent_id, lean, ticker, conf)
      values (${who}, ${body}, ${kind}, ${parent}, ${lean}, ${ticker}, ${conf})
      returning id, who, body, kind, parent_id, lean, ticker, conf, created_at
    `;
    return asPost(rows[0]!);
  });
