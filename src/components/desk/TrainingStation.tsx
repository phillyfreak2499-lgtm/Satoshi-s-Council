import { useParams } from "@tanstack/react-router";
import { stationCopy } from "@/lib/desk/training";

export function TrainingStation() {
  const { coach: id } = useParams({ from: "/training/$coach" });
  const copy = stationCopy(id);
  if (!copy) return null;
  const { coach, questions, role, lessonOne } = copy;
  return (
    <main id="training-main" className="bg-bg text-fg">
      <div className="gutter flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface py-3">
        <a href="/training" className="flex min-h-8 items-center font-mono text-micro text-muted hover:text-fg">← Choose another coach</a>
        <span className="font-mono text-micro uppercase text-subtle">{coach.name} / {coach.specialty} · GUIDED COACH</span>
      </div>

      <section className="gutter mx-auto w-full max-w-4xl py-8 sm:py-10" aria-labelledby="station-title">
        <p className="font-mono text-micro uppercase tracking-widest text-wait">The apprentice desk</p>
        <h1 id="station-title" className="mt-3 font-sans text-display font-medium tracking-tight">{coach.name}’s station</h1>
        <p className="mt-3 max-w-2xl font-sans text-body leading-relaxed text-muted">{coach.lesson}</p>
        <p className="mt-2 max-w-2xl font-sans text-ui leading-relaxed text-subtle">{role} Paper only. No live orders. Open-ended AI conversation is not connected.</p>

        {lessonOne ? (
          <div className="mt-8 rounded-md border border-wait/30 bg-surface p-5 sm:p-6">
            <h2 className="font-sans text-title font-medium">{lessonOne.title}</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 font-sans text-body leading-relaxed text-fg">
              {lessonOne.points.map((point) => <li key={point}>{point}</li>)}
            </ol>
          </div>
        ) : null}

        {questions.length ? (
          <div className="mt-8">
            <h2 className="font-sans text-title font-medium">Guided questions</h2>
            <p className="mt-2 font-mono text-micro text-subtle">These are the questions the station can answer. There is no open chat.</p>
            <dl className="mt-4 space-y-4">
              {questions.map((item) => (
                <div key={item.q} className="rounded-md border border-border bg-surface p-4">
                  <dt className="font-sans text-ui font-medium text-fg">{item.q}</dt>
                  <dd className="mt-2 font-sans text-body leading-relaxed text-muted">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>

      <iframe
        key={coach.id}
        src={`/training-desk/${coach.id}/index.html`}
        title={`${coach.name}’s six-screen training station`}
        className="block w-full border-0 border-t border-border"
        style={{ height: "calc(100dvh - 130px)", minHeight: 560 }}
      />
    </main>
  );
}
