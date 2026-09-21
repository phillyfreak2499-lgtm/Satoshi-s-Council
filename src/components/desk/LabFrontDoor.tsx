/**
 * The Lab's summary layer. Read-only presentation above the existing bench.
 *
 * It renders whatever `labFrontDoor` hands it and nothing else. No study is
 * ranked, no conclusion is drawn, and the full detailed research below is
 * untouched — this is a front door, not a replacement.
 */
import type { PublicLabRegistrySnapshot } from "@/lib/desk/lab-registry.server";
import { LAB_RESEARCH_REGISTRY } from "@/lib/desk/lab-registry";
import {
  declaredBench,
  FRONT_DOOR_COPY,
  labFrontDoor,
  type FrontDoorCard,
  type FrontDoorRow,
} from "@/lib/desk/lab-front-door";

function Card({ c }: { c: FrontDoorCard }) {
  return (
    <li className="flex flex-col rounded-sm border border-border bg-canvas p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-ui text-fg">{c.label}</span>
        <span className="rounded-sm border border-border px-1.5 font-mono text-micro uppercase tracking-wider text-subtle">
          {c.authority}
        </span>
      </div>
      {c.purpose ? (
        <p className="mt-1.5 font-sans text-ui leading-relaxed text-muted">{c.purpose}</p>
      ) : null}
      <p className="mt-2 font-mono text-micro text-subtle">
        {c.status}
        {c.sample == null ? "" : ` · ${c.sample.toLocaleString("en-US")} recorded`}
      </p>
    </li>
  );
}

function Group({
  id,
  title,
  note,
  cards,
}: {
  id: string;
  title: string;
  note: string;
  cards: FrontDoorCard[];
}) {
  return (
    <section aria-labelledby={id} className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={id} className="font-mono text-micro uppercase tracking-widest text-fg">
          {title}
        </h3>
        <span className="font-mono text-micro text-subtle">{cards.length}</span>
      </div>
      <p className="mt-1 max-w-[80ch] font-sans text-ui leading-relaxed text-muted">{note}</p>
      {cards.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Card key={c.id} c={c} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 font-mono text-micro text-subtle">Nothing in this state right now.</p>
      )}
    </section>
  );
}

export function LabFrontDoor({ registry }: { registry: PublicLabRegistrySnapshot | null }) {
  // The live lifecycle scan did not answer this request. That is a missing set
  // of COUNTS, not a missing bench: the register is frozen in this bundle and
  // every study below renders from its own snapshot regardless. So the bench is
  // still listed, with the numbers withheld and said plainly to be withheld.
  if (!registry) {
    const declared = declaredBench(LAB_RESEARCH_REGISTRY);
    return (
      <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="lab-door">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">The Lab</p>
            <h2 id="lab-door" className="mt-1 font-sans text-title font-medium text-fg">
              The bench at a glance
            </h2>
          </div>
          <span className="rounded-sm border border-gold/40 bg-canvas px-2 py-0.5 font-mono text-micro uppercase tracking-widest text-gold">
            {declared.length} studies · authority none
          </span>
        </div>
        <p className="mt-2 max-w-[80ch] font-sans text-ui leading-relaxed text-muted">
          {FRONT_DOOR_COPY.pending}
        </p>
        <Group id="lab-declared" title="On the bench" note={FRONT_DOOR_COPY.declared} cards={declared} />
        <p className="mt-5 max-w-[80ch] border-t border-border pt-3 font-mono text-micro leading-relaxed text-subtle">
          {FRONT_DOOR_COPY.footer}
        </p>
      </section>
    );
  }
  const door = labFrontDoor(registry.rows as unknown as FrontDoorRow[]);
  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="lab-door">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">The Lab</p>
          <h2 id="lab-door" className="mt-1 font-sans text-title font-medium text-fg">
            The bench at a glance
          </h2>
        </div>
        <span className="rounded-sm border border-gold/40 bg-canvas px-2 py-0.5 font-mono text-micro uppercase tracking-widest text-gold">
          {door.counts.total} studies · authority none
        </span>
      </div>

      <Group id="lab-running" title="Running now" note={FRONT_DOOR_COPY.running} cards={door.running} />
      <section aria-labelledby="lab-learning" className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="lab-learning" className="font-mono text-micro uppercase tracking-widest text-fg">
            What we&apos;re learning
          </h3>
          <span className="font-mono text-micro text-subtle">{door.counts.with_evidence} with evidence</span>
        </div>
        <p className="mt-1 max-w-[80ch] font-sans text-ui leading-relaxed text-muted">
          {FRONT_DOOR_COPY.learning}
        </p>
        {door.learning.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {door.learning.map((t) => (
              <li key={t} className="flex gap-2 font-sans text-ui leading-relaxed text-fg">
                <span aria-hidden="true" className="text-subtle">·</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 font-mono text-micro text-subtle">The register is empty this request.</p>
        )}
      </section>
      <Group id="lab-notready" title="Not ready" note={FRONT_DOOR_COPY.not_ready} cards={door.not_ready} />

      <p className="mt-5 max-w-[80ch] border-t border-border pt-3 font-mono text-micro leading-relaxed text-subtle">
        {FRONT_DOOR_COPY.footer}
      </p>
    </section>
  );
}
