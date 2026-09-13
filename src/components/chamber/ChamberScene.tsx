import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { alchemistAccent, satoshiAccent, wardenAccent, type ChamberState, type Figure, type Station } from "@/lib/chamber/states.ts";
import { dprFor } from "./webgl";
import { Alchemist } from "./scene/Alchemist";
import { Architecture } from "./scene/Architecture";
import { CameraRig } from "./scene/CameraRig";
import { Lighting } from "./scene/Lighting";
import { BG } from "./scene/palette";
import { Satoshi } from "./scene/Satoshi";
import { Ticker } from "./scene/Ticker";
import { Warden } from "./scene/Warden";

export type ChamberSceneProps = {
  state: ChamberState;
  station: Station;
  onPick: (figure: Figure) => void;
  reduced: boolean;
  mobile: boolean;
  paused: boolean;
  onReady: () => void;
};

/**
 * The room. Lazy-loaded by the route, so three.js and React Three Fiber exist only
 * on /chamber. Conservative by default: capped DPR, no shadows, no postprocessing,
 * on-demand frames, antialias off on phones. R3F owns the renderer's lifecycle and
 * disposes the scene graph on unmount; nothing here disposes by hand.
 */
export default function ChamberScene({ state, station, onPick, reduced, mobile, paused, onReady }: ChamberSceneProps) {
  const sat = satoshiAccent(state.satoshi, state.direction);
  const alc = alchemistAccent(state.alchemist);
  const war = wardenAccent(state.warden);
  return (
    <Canvas
      dpr={dprFor(mobile)}
      gl={{ antialias: !mobile, powerPreference: "low-power", alpha: false, stencil: false }}
      shadows={false}
      frameloop="demand"
      camera={{ fov: 42, near: 0.5, far: 140, position: [0, 9.6, 19.5] }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(BG, 1);
        gl.toneMappingExposure = 1.25;
        scene.background = new THREE.Color(BG);
      }}
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
    >
      <Lighting mobile={mobile} lab={alc} ops={war} />
      <Architecture onPick={onPick} reduced={reduced} />
      <Satoshi state={state.satoshi} accent={sat} reduced={reduced} onPick={() => onPick("SATOSHI")} />
      <Alchemist state={state.alchemist} accent={alc} reduced={reduced} onPick={() => onPick("ALCHEMIST")} />
      <Warden state={state.warden} accent={war} reduced={reduced} onPick={() => onPick("WARDEN")} />
      <CameraRig station={station} reduced={reduced} />
      <Ticker paused={paused} reduced={reduced} onReady={onReady} />
    </Canvas>
  );
}
