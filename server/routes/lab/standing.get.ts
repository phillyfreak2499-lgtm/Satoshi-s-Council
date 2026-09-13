/** THE LAB's standing, admin-key only.
 *
 *  Who the current Floor Champion is, and what each frozen exit candidate would
 *  have done to the positions the Chair actually took. Every candidate is handed
 *  the identical real fill, priced only at the executable bid for the side held,
 *  with entry and exit fees modelled — so the comparison is between exit policies
 *  and nothing else.
 *
 *  Direction and profit are reported separately on purpose: a candidate can be
 *  direction-wrong on every window and still be the better policy because it lost
 *  far less. Collapsing those into one "win rate" is how a loss-reducer gets
 *  mistaken for a bad predictor.
 *
 *  Read-only research at /lab/standing. Nothing here votes, promotes, or places an
 *  order — the desk is paper only. Wrong or missing key → 404. */
export default async function labStandingAdmin(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });

    const { labStanding } = await import("../../../src/lib/desk/policy-lab.server");
    const { policyLine } = await import("../../../src/lib/desk/floor-policy");
    const { COMPONENT_MIN } = await import("../../../src/lib/desk/promotion-gates");

    const s = await labStanding();
    return json({
      at: s.at,
      champion: { ...s.champion, reads_as: policyLine(s.champion) },
      // Stated rather than implied: this endpoint reports, and the promotion
      // actuator is a separate, later change. Nothing here can promote.
      authority: { promotes_nothing: true, paper_only: true },
      minimums: { ...COMPONENT_MIN },
      candidates: s.rows,
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
