import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export const specText = await readFile(new URL("./spec.json", import.meta.url), "utf8");
export const spec = JSON.parse(specText);
export const specHash = createHash("sha256").update(specText).digest("hex");
export async function register(client) {
  await client.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  await client.query(
    "insert into weather_research.study(id,spec_hash,spec) values($1,$2,$3) on conflict do nothing",
    [spec.id, specHash, spec],
  );
  const row = (await client.query("select * from weather_research.study where id=$1", [spec.id]))
    .rows[0];
  if (row.spec_hash !== specHash) throw Error("frozen spec changed: collection refused");
  return row;
}
export async function stop(client, reason) {
  await client.query(
    "update weather_research.study set stopped_at=coalesce(stopped_at,now()),stop_reason=coalesce(stop_reason,$2) where id=$1",
    [spec.id, reason],
  );
}
export async function residuals(client, city, slot, target, at) {
  return (
    await client.query(
      `with official as (
    select target_date,min(official_high_f) as high from weather_research.outcomes
    where study=$1 and city=$2 and target_date<$4::date and discovered_at<=$5::timestamptz
    group by target_date having min(official_high_f)=max(official_high_f)
  ) select o.high-s.forecast_f as error from weather_research.snapshots s join official o using(target_date)
    where s.study=$1 and s.city=$2 and s.slot=$3 and s.forecast_f is not null and s.quality->>'valid'='true'
    order by s.target_date desc limit $6`,
      [spec.id, city, slot, target, at, spec.training_window_city_days],
    )
  ).rows.map((r) => Number(r.error));
}
export async function receipt(client, city, kind, url, body, at, sourceTime) {
  const budget = (await client.query(
    "select coalesce(sum(pg_column_size(body)),0)::bigint as stored, pg_column_size($2::jsonb)::bigint as incoming from weather_research.receipts where study=$1",
    [spec.id, body],
  )).rows[0];
  if (Number(budget.stored) + Number(budget.incoming) > spec.max_raw_storage_bytes) {
    await stop(client, "raw storage budget exceeded");
    throw Error("raw storage budget exceeded: receipt refused");
  }
  return (
    await client.query(
      `insert into weather_research.receipts(study,city,kind,url,received_at,source_time,body)
    values($1,$2,$3,$4,$5,$6,$7) returning id`,
      [spec.id, city, kind, url, at, sourceTime, body],
    )
  ).rows[0].id;
}
