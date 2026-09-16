import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { chairSignalOf, signalDescription, signalReading, type ChairSignalInput } from "@/lib/desk/chair-signal";
import "./ChairSignalGauge.css";

/** A display instrument, not a decision maker. Decorative liquid never moves the marker. */
export function ChairSignalGauge({ chair, feedHealthy = true }: { chair: ChairSignalInput; feedHealthy?: boolean }) {
  const signal = chairSignalOf(chair);
  const description = signalDescription(signal);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(media.matches);
    let intersecting = true;
    const updateVisibility = () => setVisible(intersecting && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      updateVisibility();
    });
    if (root.current) observer?.observe(root.current);
    updateMotion();
    updateVisibility();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  return (
    <div
      ref={root}
      className="chair-signal"
      data-available={signal != null}
      data-reduced={reduced}
      data-animating={visible && !paused && !reduced && feedHealthy && signal != null}
      data-chair-decision={chair.lean}
      style={{ "--signal-position": `${signal?.position ?? 50}%` } as CSSProperties}
    >
      <div className="chair-signal__head">
        <div className="chair-signal__tools">
          <details className="chair-signal__help">
            <summary id={`${id}-label`}>Chair signal<span className="chair-signal__info" aria-hidden="true">ⓘ</span></summary>
            <div className="chair-signal__popover">
              <p>Red is DOWN. Green is UP. Gold is below the signal threshold. The white marker shows the current signal; the two ticks are the thresholds.</p>
              <p>Signal = score × aggressiveness. The scale adjusts to the current threshold. Crossing a tick clears the signal check, not every check. The Chair may still WAIT, and paper entry is separate.</p>
              <p>{description}</p>
            </div>
          </details>
          <button
            type="button"
            className="chair-signal__pause"
            aria-label="Pause liquid animation"
            aria-pressed={paused}
            title={paused ? "Resume liquid animation. Live signal keeps updating." : "Pause liquid animation. Live signal keeps updating."}
            onClick={() => setPaused((v) => !v)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
              {paused ? <path d="M2 1 9 5 2 9Z" /> : <path d="M2 1H4V9H2ZM6 1H8V9H6Z" />}
            </svg>
          </button>
        </div>
        <span className="chair-signal__value" title="Effective signal / negative and positive thresholds">{signalReading(signal)}</span>
      </div>
      <div
        className="chair-signal__axis"
        role={signal ? "meter" : "img"}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        aria-valuemin={signal ? -2 : undefined}
        aria-valuemax={signal ? 2 : undefined}
        aria-valuenow={signal ? Math.max(-2, Math.min(2, signal.ratio)) : undefined}
        aria-valuetext={signal ? description : undefined}
      >
        <span className="chair-signal__end chair-signal__end--down" aria-hidden="true">DOWN</span>
        <div className="chair-signal__instrument" aria-hidden="true">
          <div className="chair-signal__tube">
            <div className="chair-signal__zones" />
            <div className="chair-signal__liquid chair-signal__liquid--back" />
            <div className="chair-signal__liquid" />
            <div className="chair-signal__glass" />
          </div>
          <span className="chair-signal__tick chair-signal__tick--down" />
          <span className="chair-signal__zero" />
          <span className="chair-signal__tick chair-signal__tick--up" />
          {signal ? <span className="chair-signal__marker" /> : null}
        </div>
        <span className="chair-signal__end chair-signal__end--up" aria-hidden="true">UP</span>
      </div>
      <span id={`${id}-description`} className="sr-only">{description}</span>
    </div>
  );
}
