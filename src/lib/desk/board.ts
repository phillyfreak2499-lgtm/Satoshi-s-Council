import { createServerFn } from "@tanstack/react-start";

export type BoardPost = {
  id: number;
  who: string;
  body: string;
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
  lean: string;
  ticker: string;
  conf: number;
  created_at: string | Date | number;
}): BoardPost {
  const t =
    typeof row.created_at === "number"
      ? row.created_at
      : new Date(row.created_at).getTime();
  return {
    id: Number(row.id),
    who: row.who,
    body: row.body,
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
    lean: string;
    ticker: string;
    conf: number;
    created_at: string | Date;
  }>`select id, who, body, lean, ticker, conf, created_at from board order by id desc limit 60`;
  return rows.map(asPost).reverse();
});

export const postBoard = createServerFn({ method: "POST" })
  .validator((data: { who: string; body: string; lean?: string; ticker?: string; conf?: number }) => data)
  .handler(async ({ data }) => {
    const who = clean(data.who, 24) || "anon";
    const body = clean(data.body, 400);
    if (!body) throw new Error("Write a note first.");
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
    const rows = await sql<{
      id: number;
      who: string;
      body: string;
      lean: string;
      ticker: string;
      conf: number;
      created_at: string | Date;
    }>`
      insert into board (who, body, lean, ticker, conf)
      values (${who}, ${body}, ${lean}, ${ticker}, ${conf})
      returning id, who, body, lean, ticker, conf, created_at
    `;
    return asPost(rows[0]!);
  });
