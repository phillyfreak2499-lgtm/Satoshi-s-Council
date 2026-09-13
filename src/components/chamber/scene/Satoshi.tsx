import { useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type * as THREE from "three";
import type { Accent, SatoshiState } from "@/lib/chamber/states.ts";
import { P } from "./palette";

/**
 * Power through hierarchy, silhouette and stillness. The figure is the darkest thing
 * in the room; its state is carried by the dais ring and the chair's back strip, not
 * by the body. DIRECTIONAL is the stillest state of all.
 */
export function Satoshi({ state, accent, reduced, onPick }: { state: SatoshiState; accent: Accent; reduced: boolean; onPick: () => void }) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = body.current;
    const h = head.current;
    if (!g || !h) return;
    const t = clock.elapsedTime;
    const amp = reduced ? 0 : 1;
    const lean = state === "CONSIDERING" ? 0.14 : state === "WAIT" ? -0.07 : 0;
    const breath = state === "DIRECTIONAL" ? 0.003 : 0.008;
    g.rotation.x = lean + amp * Math.sin(t * 1.1) * 0.004;
    g.scale.y = 1 + amp * Math.sin(t * 1.25) * breath;
    const turn = state === "OBSERVING" ? Math.sin(t * 0.28) * 0.09 : state === "CONSIDERING" ? Math.sin(t * 0.5) * 0.03 : 0;
    h.rotation.y = amp * turn;
    h.rotation.x = state === "CONSIDERING" ? 0.12 : 0;
  });
  const pick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onPick();
  };
  return (
    <group position={[0, 0.56, -0.9]} onPointerDown={pick}>
      {/* presence: the dais ring */}
      <mesh position={[0, 0.012, 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.52, 2.66, 48]} />
        <meshStandardMaterial color="#000000" emissive={accent.hex} emissiveIntensity={accent.intensity} roughness={1} />
      </mesh>
      {/* the command chair */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[1.0, 0.5, 0.8]} />
        <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.57, 0]}>
        <boxGeometry args={[1.3, 0.14, 1.0]} />
        <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.35} />
      </mesh>
      <mesh position={[0, 1.7, -0.5]} rotation={[-0.1, 0, 0]}>
        <boxGeometry args={[1.2, 2.3, 0.18]} />
        <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.35} />
      </mesh>
      <mesh position={[0, 1.45, -0.39]} rotation={[-0.1, 0, 0]}>
        <boxGeometry args={[0.07, 1.6, 0.02]} />
        <meshStandardMaterial color="#000000" emissive={accent.hex} emissiveIntensity={accent.intensity * 0.7} roughness={1} />
      </mesh>
      {[-0.62, 0.62].map((x) => (
        <mesh key={x} position={[x, 0.85, 0.02]}>
          <boxGeometry args={[0.16, 0.12, 0.9]} />
          <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.35} />
        </mesh>
      ))}
      {/* the figure, seated */}
      <group ref={body} position={[0, 0.64, 0]}>
        <mesh position={[0, 0.56, 0.02]}>
          <cylinderGeometry args={[0.33, 0.46, 1.05, 6]} />
          <meshStandardMaterial color={P.cloth} roughness={0.95} />
        </mesh>
        <mesh position={[0, 1.1, 0]}>
          <boxGeometry args={[1.0, 0.2, 0.5]} />
          <meshStandardMaterial color={P.cloth} roughness={0.95} />
        </mesh>
        <group ref={head} position={[0, 1.36, 0]}>
          <mesh position={[0, 0, 0.02]}>
            <icosahedronGeometry args={[0.22, 0]} />
            <meshStandardMaterial color={P.skin} roughness={1} />
          </mesh>
          <mesh position={[0, 0.16, -0.02]} rotation={[0.16, 0, 0]}>
            <coneGeometry args={[0.5, 0.82, 5, 1, true]} />
            <meshStandardMaterial color={P.cloth} roughness={0.95} side={2} />
          </mesh>
        </group>
        {[-0.45, 0.45].map((x) => (
          <group key={x}>
            <mesh position={[x, 0.72, 0.12]} rotation={[0.35, 0, 0]}>
              <boxGeometry args={[0.18, 0.7, 0.18]} />
              <meshStandardMaterial color={P.cloth} roughness={0.95} />
            </mesh>
            <mesh position={[x * 1.25, 0.34, 0.28]}>
              <boxGeometry args={[0.16, 0.16, 0.6]} />
              <meshStandardMaterial color={P.cloth} roughness={0.95} />
            </mesh>
          </group>
        ))}
        {[-0.22, 0.22].map((x) => (
          <group key={x}>
            <mesh position={[x, 0.08, 0.42]}>
              <boxGeometry args={[0.28, 0.24, 0.75]} />
              <meshStandardMaterial color={P.cloth} roughness={0.95} />
            </mesh>
            <mesh position={[x, -0.34, 0.78]}>
              <boxGeometry args={[0.24, 0.7, 0.24]} />
              <meshStandardMaterial color={P.cloth} roughness={0.95} />
            </mesh>
            <mesh position={[x, -0.58, 0.9]}>
              <boxGeometry args={[0.24, 0.12, 0.36]} />
              <meshStandardMaterial color={P.cloth} roughness={0.95} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
