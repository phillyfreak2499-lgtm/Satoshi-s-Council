import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { SiteHeader } from "@/components/desk/SiteHeader";
import { FIXTURES, fixtureFromSearch, type FixtureId } from "@/lib/chamber/fixtures.ts";
import { stationFor, type Figure, type Station } from "@/lib/chamber/states.ts";
import { ChamberErrorBoundary } from "./ChamberErrorBoundary";
import { ChamberFallback } from "./ChamberFallback";
import { Hud } from "./hud/Hud";
import { MOBILE_LIKE, REDUCED_MOTION, mediaMatches, probeWebGL2, watchMedia } from "./webgl";

/** The only door to three.js / React Three Fiber: fetched when, and only when, this renders —
 *  and compiled out of the server build (`ssr: false` keeps the route off the server; this keeps
 *  the renderer out of its bundle too). */
const ChamberScene = import.meta.env.SSR ? null : lazy(() => import("./ChamberScene"));

type WebGL = "probing" | "ok" | "missing";

function figureAt(s: Station): Figure | null {
  return s === "DAIS" ? "SATOSHI" : s === "LAB" ? "ALCHEMIST" : s === "OPS" ? "WARDEN" : null;
}

/**
 * /chamber's shell. Probes WebGL2 before fetching any 3D code, owns the camera
 * station and the selected figure, reads the dev fixture, and degrades to the plain
 * fallback on a missing context or a scene failure. It reads nothing from the desk.
 */
export function ChamberRoute() {
  const [webgl, setWebgl] = useState<WebGL>("probing");
  const [failed, setFailed] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [station, setStation] = useState<Station>("OVERVIEW");
  const [selected, setSelected] = useState<Figure | null>(null);
  const [fixture, setFixture] = useState<{ id: FixtureId; explicit: boolean }>({ id: "quiet", explicit: false });
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    setWebgl(probeWebGL2() ? "ok" : "missing");
    setReduced(mediaMatches(REDUCED_MOTION));
    setMobile(mediaMatches(MOBILE_LIKE));
    setFixture(fixtureFromSearch(window.location.search));
    const offReduced = watchMedia(REDUCED_MOTION, setReduced);
    const offMobile = watchMedia(MOBILE_LIKE, setMobile);
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStation("OVERVIEW");
        setSelected(null);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey);
    return () => {
      offReduced();
      offMobile();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const goto = useCallback((s: Station) => {
    setStation(s);
    setSelected(figureAt(s));
  }, []);
  const pick = useCallback((figure: Figure) => {
    setSelected(figure);
    setStation(stationFor(figure));
  }, []);
  const onReady = useCallback(() => setSceneReady(true), []);

  if (webgl === "missing") return <ChamberFallback reason="webgl2" />;
  if (failed !== null) return <ChamberFallback reason="error" detail={failed} />;

  const state = FIXTURES[fixture.id].state;
  const showDev = import.meta.env.DEV || fixture.explicit;

  return (
    <div
      className="flex min-h-dvh flex-col bg-bg text-fg"
      data-chamber=""
      data-webgl={webgl}
      data-reduced={reduced ? "true" : "false"}
      data-mobile={mobile ? "true" : "false"}
      data-station={station}
      data-ready={sceneReady ? "true" : "false"}
    >
      <a href="#chamber-stage" className="skip-link">
        Skip to the chamber
      </a>
      <SiteHeader
        brandHref="/"
        nav={
          <nav aria-label="Chamber" className="flex items-center gap-1">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => goto("OVERVIEW")}>
              Overview
            </button>
            <a href="/" className="btn btn-primary btn-sm">
              Open the floor
            </a>
          </nav>
        }
        menu={[
          { label: "Overview", onSelect: () => goto("OVERVIEW"), hint: "camera" },
          { label: "Open the floor", href: "/" },
          { label: "The Pit", href: "/arena", hint: "room" },
        ]}
      />
      <section
        id="chamber-stage"
        className="relative w-full overflow-hidden bg-[#07080b]"
        style={{ height: "calc(100dvh - var(--header-h))" }}
        aria-label="The Chamber — a 3D observation view of the desk. Presentation fixtures only; nothing here is live desk state."
      >
        {webgl === "ok" && ChamberScene ? (
          <ChamberErrorBoundary onError={(e) => setFailed(e.message || "scene error")}>
            <Suspense fallback={null}>
              <ChamberScene
                state={state}
                station={station}
                onPick={pick}
                reduced={reduced}
                mobile={mobile}
                paused={hidden}
                onReady={onReady}
              />
            </Suspense>
          </ChamberErrorBoundary>
        ) : null}
        <Hud
          station={station}
          onStation={goto}
          selected={selected}
          onClear={() => setSelected(null)}
          state={state}
          fixture={fixture.id}
          onFixture={(id) => setFixture({ id, explicit: true })}
          showDev={showDev}
          reduced={reduced}
          loading={webgl === "probing" || !sceneReady}
        />
      </section>
    </div>
  );
}
