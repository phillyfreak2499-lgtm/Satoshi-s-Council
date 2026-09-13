import { useLayoutEffect, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Accent, WardenState } from "@/lib/chamber/states.ts";
import { P } from "./palette";

const LED_COLS = 6;
const LED_ROWS = 10;
const LEDS = LED_COLS * LED_ROWS;

/**
 * Integrity. Broad, controlled, utilitarian; visually disciplined. Minimal movement
 * when healthy. The console screens and the rack LEDs carry the integrity accent
 * (green / amber / red); the figure itself turns toward the rack to INVESTIGATE and
 * leans to the console on ALERT. No incident is ever invented here.
 */
export function Warden({ state, accent, reduced, onPick }: { state: WardenState; accent: Accent; reduced: boolean; onPick: () => void }) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const arms = useRef<THREE.Group>(null);
  const leds = useRef<THREE.InstancedMesh>(null);
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);
  useLayoutEffect(() => {
    const m = leds.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < LEDS; i++) {
      const c = i % LED_COLS;
      const r = Math.floor(i / LED_COLS);
      o.position.set(-0.4 + c * 0.16, 0.4 + r * 0.26, 0.57);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(({ clock }) => {
    const g = body.current;
    const h = head.current;
    const a = arms.current;
    const lm = ledMat.current;
    if (!g || !h || !a) return;
    const t = clock.elapsedTime;
    const amp = reduced ? 0 : 1;
    const turn = state === "INVESTIGATING" ? 0.55 : 0;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, turn, 3, 0.05);
    g.rotation.x = state === "ALERT" ? 0.12 : 0;
    g.scale.y = 1 + amp * Math.sin(t * 1.05) * 0.004;
    h.rotation.y = state === "INVESTIGATING" ? 0.2 + amp * Math.sin(t * 0.7) * 0.05 : amp * Math.sin(t * 0.2) * 0.03;
    a.rotation.x = state === "ALERT" ? -0.9 : -0.15;
    if (lm) lm.emissiveIntensity = accent.intensity * (reduced ? 1 : 0.85 + 0.15 * Math.sin(t * (state === "ALERT" ? 6 : 1.6)));
  });
  const pick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onPick();
  };
  return (
    <>
      {/* the figure, at the console, facing −z */}
      <group position={[10.4, 0.1, 2.2]} onPointerDown={pick}>
        <group ref={body}>
          {[-0.24, 0.24].map((x) => (
            <mesh key={x} position={[x, 0.5, 0]}>
              <boxGeometry args={[0.32, 1.0, 0.34]} />
              <meshStandardMaterial color="#1b1f27" roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[0, 1.6, 0]}>
            <boxGeometry args={[0.95, 1.2, 0.5]} />
            <meshStandardMaterial color="#1b1f27" roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.55, 0.12]}>
            <boxGeometry args={[0.7, 0.9, 0.3]} />
            <meshStandardMaterial color="#0f1115" roughness={0.95} />
          </mesh>
          <mesh position={[0, 2.25, 0]}>
            <boxGeometry args={[1.25, 0.2, 0.55]} />
            <meshStandardMaterial color="#1b1f27" roughness={0.9} />
          </mesh>
          <group ref={arms} position={[0, 2.15, 0]}>
            {[-0.7, 0.7].map((x) => (
              <mesh key={x} position={[x, -0.45, 0]}>
                <boxGeometry args={[0.24, 0.9, 0.26]} />
                <meshStandardMaterial color="#1b1f27" roughness={0.9} />
              </mesh>
            ))}
          </group>
          <group ref={head} position={[0, 2.55, 0]}>
            <mesh>
              <boxGeometry args={[0.34, 0.36, 0.34]} />
              <meshStandardMaterial color="#0b0c10" roughness={1} />
            </mesh>
          </group>
        </group>
      </group>
      {/* Operations' integrity accent: five console screens and the rack LEDs */}
      <group position={[11, 0, 0.6]}>
        {[-2.0, -1.0, 0, 1.0, 2.0].map((x) => (
          <group key={x} position={[x, 1.2, -0.62]} rotation={[-0.22, 0, 0]}>
            <mesh>
              <boxGeometry args={[0.82, 0.52, 0.06]} />
              <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.3} />
            </mesh>
            <mesh position={[0, 0, 0.035]}>
              <boxGeometry args={[0.72, 0.42, 0.01]} />
              <meshStandardMaterial color="#050705" emissive={accent.hex} emissiveIntensity={accent.intensity * 0.9} roughness={0.4} />
            </mesh>
          </group>
        ))}
        <group position={[2.4, 0, -3.0]}>
          <instancedMesh ref={leds} args={[undefined, undefined, LEDS]} frustumCulled={false}>
            <boxGeometry args={[0.06, 0.06, 0.03]} />
            <meshStandardMaterial ref={ledMat} color="#000000" emissive={accent.hex} emissiveIntensity={accent.intensity} roughness={0.5} />
          </instancedMesh>
        </group>
      </group>
    </>
  );
}
