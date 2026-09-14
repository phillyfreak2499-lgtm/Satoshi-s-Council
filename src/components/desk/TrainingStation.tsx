export function TrainingStation() {
  return <main id="training-main">
    <div className="gutter flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface py-3">
      <a href="/training" className="flex min-h-8 items-center font-mono text-micro text-muted hover:text-fg">← Choose another coach</a>
      <span className="font-mono text-micro text-subtle">WICK / CANDLE STRUCTURE · GUIDED COACH</span>
    </div>
    <iframe src="/training-desk/wick/index.html" title="WICK’s six-screen training station" className="block w-full border-0" style={{ height: "calc(100dvh - 130px)", minHeight: 560 }} />
  </main>;
}
