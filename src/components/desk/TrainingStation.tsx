import { useParams } from "@tanstack/react-router";
import { availableCoach } from "@/lib/desk/training";
export function TrainingStation() {
  const { coach: id } = useParams({ from: "/training/$coach" });
  const coach = availableCoach(id);
  if (!coach) return null;
  return <main id="training-main">
    <div className="gutter flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface py-3">
      <a href="/training" className="flex min-h-8 items-center font-mono text-micro text-muted hover:text-fg">← Choose another coach</a>
      <span className="font-mono text-micro uppercase text-subtle">{coach.name} / {coach.specialty} · GUIDED COACH</span>
    </div>
    <iframe key={coach.id} src={`/training-desk/${coach.id}/index.html`} title={`${coach.name}’s six-screen training station`} className="block w-full border-0" style={{ height: "calc(100dvh - 130px)", minHeight: 560 }} />
  </main>;
}
