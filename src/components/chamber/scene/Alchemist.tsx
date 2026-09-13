import { useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type * as THREE from "three";
import type { Accent, AlchemistState } from "@/lib/chamber/states.ts";
import { P } from "./palette";

/**
 * Experiment. A tall thin silhouette with an asymmetric coat and a restrained
 * eyepiece, more naturally active than the Chair. Drifting between benches, leaning
 * in, swaying — all of it ambient and meaningless. The Lab's screens and specimen
 * carry the research accent (amber); nothing here is an outcome.
 */
export function Alchemist({ state, accent, reduced, onPick }: { state: AlchemistState; accent: Accent; reduced: boolean; onPick: () => void }) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const r = root.current;
    const b = torso.current;
    const h = head.current;
    if (!r || !b || !h) return;
    const t = clock.elapsedTime;
    const amp = reduced ? 0 : 1;
    // Drift between the two benches while ACTIVE; stand otherwise.
    const drift = state === "ACTIVE" ? -1.25 + 1.25 * Math.cos(t * 0.42) : 0;
    r.position.z = 1.6 + amp * drift;
    b.rotation.z = amp * Math.sin(t * 0.9) * 0.012;
    b.rotation.x = state === "INSPECTING" ? 0.24 : state === "ACTIVE" ? 0.1 + amp * Math.sin(t * 0.42) * 0.06 : amp * Math.sin(t * 0.6) * 0.015;
    h.rotation.x = state === "INSPECTING" ? 0.38 : state === "ACTIVE" ? 0.18 : 0.04;
    h.rotation.y = amp * (state === "IDLE" ? Math.sin(t * 0.33) * 0.25 : Math.sin(t * 0.8) * 0.08);
  });
  const pick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onPick();
  };
  return (
    <>
      {/* the figure, facing the benches (−x) */}
      <group ref={root} position={[-10.3, 0.1, 1.6]} rotation={[0, Math.PI / 2, 0]} onPointerDown={pick}>
        {[-0.13, 0.13].map((x) => (
          <mesh key={x} position={[x, 0.43, 0]}>
            <cylinderGeometry args={[0.08, 0.1, 0.86, 5]} />
            <meshStandardMaterial color={P.cloth} roughness={0.95} />
          </mesh>
        ))}
        <group ref={torso} position={[0, 0.86, 0]}>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.19, 0.25, 1.2, 6]} />
            <meshStandardMaterial color="#15171d" roughness={0.95} />
          </mesh>
          {/* asymmetric coat panel and shoulder */}
          <mesh position={[-0.2, 0.45, 0.06]}>
            <boxGeometry args={[0.22, 0.9, 0.14]} />
            <meshStandardMaterial color={P.clothLight} roughness={0.9} />
          </mesh>
          <mesh position={[0.26, 1.2, 0]}>
            <boxGeometry args={[0.5, 0.12, 0.3]} />
            <meshStandardMaterial color={P.clothLight} roughness={0.9} />
          </mesh>
          {[-0.3, 0.3].map((x) => (
            <mesh key={x} position={[x, 0.55, -0.12]} rotation={[0.5, 0, 0]}>
              <cylinderGeometry args={[0.06, 0.07, 0.8, 5]} />
              <meshStandardMaterial color="#15171d" roughness={0.95} />
            </mesh>
          ))}
          <group ref={head} position={[0, 1.36, 0]}>
            <mesh>
              <icosahedronGeometry args={[0.19, 0]} />
              <meshStandardMaterial color="#0b0c10" roughness={1} />
            </mesh>
            {/* restrained optical apparatus */}
            <mesh position={[0.14, 0.03, -0.17]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.16, 6]} />
              <meshStandardMaterial color="#2f3642" roughness={0.5} metalness={0.6} />
            </mesh>
            <mesh position={[0.14, 0.03, -0.26]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.02, 6]} />
              <meshStandardMaterial color="#000000" emissive={P.crt} emissiveIntensity={0.5} />
            </mesh>
          </group>
        </group>
      </group>
      {/* the Lab's research accent: two bench screens and the specimen */}
      <group position={[-11, 0, 1]}>
        {[0.6, -1.9].map((z) => (
          <mesh key={z} position={[-2.7, 1.45, z]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[0.8, 0.46, 0.04]} />
            <meshStandardMaterial color="#0b0a07" emissive={accent.hex} emissiveIntensity={accent.intensity} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[-2.2, 1.5, -2.9]}>
          <cylinderGeometry args={[0.26, 0.26, 0.7, 6]} />
          <meshStandardMaterial color="#0b0a07" emissive={accent.hex} emissiveIntensity={accent.intensity * 0.8} roughness={0.3} transparent opacity={0.85} />
        </mesh>
      </group>
    </>
  );
}
