import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Page } from "@/components/desk/Page";
import { BotCard } from "@/components/desk/BotCard";
import { LeanChip } from "@/components/desk/bits";
import { useDesk } from "@/lib/desk/store";
import { SEAT_BY_ID, TAB_SEATS } from "@/lib/desk/seats";
import { SEAT_IDS, type SeatId } from "@/lib/desk/types";
import { GLOSS } from "@/lib/desk/glossary";
import { wilsonLower } from "@/lib/desk/math";
import { readScalp, scalpAvg } from "@/lib/desk/scalp";
import { ogSeatImage } from "@/lib/desk/site";
import { publicSeatSnapshot } from "@/lib/desk/seat-public";

function isSeat(id: string): id is SeatId {
  return (SEAT_IDS as readonly string[]).includes(id);
}

function deskOf(id: SeatId): string {
  return (Object.entries(TAB_SEATS).find(([, ids]) => ids.includes(id))?.[0] as string | undefined) ?? "structure";
}

/** One seat on its own page: its live card, its graded record and its skills. Paper only. */
function SeatPage() {
  const { id: raw } = Route.useParams();
  const id = raw.toUpperCase();
  const frame = useDesk();
  const initial = Route.useLoaderData();
  const [msg, setMsg] = useState<string | null>(null);
  if (!isSeat(id)) throw notFound();
  const meta = SEAT_BY_ID[id];
  const gloss = GLOSS[`seat.${id}`];
  const live = frame.snap != null;
  const snap = frame.snap ?? initial.snap;
  const vote = live ? frame.votes.find((v) => v.seat === id) : initial.vote;
  const learner = frame.learner;
  const n = live ? (learner.seat_n[id] ?? 0) : initial.n;
  const hits = live ? (learner.seat_hits[id] ?? 0) : initial.hits;
  const recent = live ? (learner.seat_recent?.[id] ?? []) : initial.recent;
  const avg = live ? scalpAvg(readScalp(learner, id).legs) : initial.avg_cents;
  const calls = live ? (learner.seat_calls?.[id] ?? 0) : initial.calls;
  const skills = live
    ? Object.values(learner.skills).filter((skill) => skill.owner === id)
    : initial.skills;
  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
        await navigator.share({ title: `${id} (${meta.callsign}) · Satoshi's Council`, url });
        setMsg("shared");
        return;
      }
      await navigator.clipboard.writeText(url);
      setMsg("link copied");
    } catch (e) {
      setMsg(e instanceof Error && e.name === "AbortError" ? null : "could not share — copy the address bar instead");
    }
  };
  return (
    <Page title={`${id} (${meta.callsign})`} lede={gloss?.body ?? meta.eyes}>
      {snap && vote ? (
        <BotCard seat={id} snap={snap} vote={vote} />
      ) : (
        <div className="rounded-md border border-border bg-surface p-3 font-mono text-micro text-muted">waiting for the desk's next frame…</div>
      )}
      <section className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-3">
          <h3 className="mb-2 font-mono text-micro uppercase tracking-widest text-subtle">Record</h3>
          {n ? (
            <div className="font-mono text-ui text-fg">
              right {hits}/{n} · {Math.round((100 * hits) / n)}% · Wilson floor {Math.round(wilsonLower(hits, n) * 100)}%
            </div>
          ) : (
            <div className="font-mono text-ui text-muted">no graded reads yet</div>
          )}
          <div className="mt-1 font-mono text-micro text-muted">
            avg {avg == null ? "—" : `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}¢`} · {calls} calls
            {vote ? (
              <>
                {" · now "}
                <LeanChip lean={vote.lean} />
              </>
            ) : null}
          </div>
          <div className="mt-2 flex gap-0.5" aria-label="Last twenty graded reads">
            {Array.from({ length: 20 }, (_, i) => {
              const v = recent[recent.length - 20 + i];
              return <span key={i} className={`h-3 flex-1 rounded-[1px] ${v == null ? "bg-surface-3" : v > 0 ? "bg-up" : "bg-down"}`} />;
            })}
          </div>
          <div className="mt-1 font-mono text-micro text-subtle">last twenty graded reads, green right, red wrong</div>
        </div>
        <div className="rounded-md border border-border bg-surface p-3">
          <h3 className="mb-2 font-mono text-micro uppercase tracking-widest text-subtle">Skills</h3>
          {skills.length ? (
            <ul className="space-y-1 font-mono text-micro text-muted">
              {skills.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-fg">{s.id.split(".")[1]}</span>
                  <span className="text-wait">{s.status}</span>
                  <span>
                    {s.n ? `${s.hits}/${s.n}` : "ungraded"}
                  </span>
                  <span className="text-subtle">{s.question}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="font-mono text-micro text-muted">this seat reads directly, without rulebook skills</div>
          )}
        </div>
      </section>
      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-micro text-muted">
        <button type="button" onClick={() => void share()} className="btn btn-secondary">
          share this seat
        </button>
        <a href={`/?seat=${id}`} className="btn btn-secondary">
          see it on the {deskOf(id).toUpperCase()} desk
        </a>
        {msg ? <span aria-live="polite">{msg}</span> : null}
      </div>
      <p className="mt-3 max-w-[70ch] font-mono text-micro leading-relaxed text-subtle">
        Every seat is graded on Kalshi&apos;s official settlement value after each 15-minute window, on paper. A read is right when the window finished
        on its side. Nothing here places a live trade. Not financial advice.
      </p>
    </Page>
  );
}

export const Route = createFileRoute("/seat/$id")({
  beforeLoad: ({ params }) => {
    if (!isSeat(params.id.toUpperCase())) throw notFound();
  },
  loader: async ({ params }) => {
    const snapshot = await publicSeatSnapshot({ data: { id: params.id } });
    if (!snapshot) throw notFound();
    return snapshot;
  },
  head: ({ params }) => {
    const id = params.id.toUpperCase();
    const meta = isSeat(id) ? SEAT_BY_ID[id] : null;
    const gloss = isSeat(id) ? GLOSS[`seat.${id}`] : undefined;
    return {
      meta: [
        { title: meta ? `${id} (${meta.callsign}) · Satoshi's Council` : "No such seat · Satoshi's Council" },
        { name: "description", content: gloss?.body ?? "One of the twenty-one seats on a paper-only Bitcoin 15-minute research desk." },
        { property: "og:description", content: gloss?.body ?? "One of the twenty-one seats on a paper-only Bitcoin 15-minute research desk." },
        ...(meta ? [{ property: "og:image", content: ogSeatImage(id) }] : []),
      ],
    };
  },
  component: SeatPage,
});
