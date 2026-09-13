import { useLayoutEffect, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Figure } from "@/lib/chamber/states.ts";
import { P } from "./palette";

/** Eight placeholder Council stations on an amphitheater arc, open toward the gallery. */
const STATION_DEG = [-118, -88, -58, -28, 28, 58, 88, 118] as const;
const R = 8.0;
const N = STATION_DEG.length;

/** Per-station local frame (+z toward the dais), then a part offset inside it. */
function placeAll(mesh: THREE.InstancedMesh | null, local: [number, number, number]) {
  if (!mesh) return;
  const o = new THREE.Object3D();
  const part = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  STATION_DEG.forEach((deg, i) => {
    const t = THREE.MathUtils.degToRad(deg);
    o.position.set(R * Math.sin(t), 0, R * Math.cos(t));
    o.lookAt(0, 0, 0);
    o.updateMatrix();
    part.compose(new THREE.Vector3(...local), q, one);
    part.premultiply(o.matrix);
    mesh.setMatrixAt(i, part);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function Stations({ reduced }: { reduced: boolean }) {
  const desks = useRef<THREE.InstancedMesh>(null);
  const legs = useRef<THREE.InstancedMesh>(null);
  const seats = useRef<THREE.InstancedMesh>(null);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const screens = useRef<THREE.InstancedMesh>(null);
  const screenMat = useRef<THREE.MeshStandardMaterial>(null);
  useLayoutEffect(() => {
    placeAll(desks.current, [0, 0.95, 0]);
    placeAll(legs.current, [0, 0.46, 0]);
    placeAll(seats.current, [0, 0.28, -0.95]);
    placeAll(bodies.current, [0, 1.26, 0.27]);
    placeAll(screens.current, [0, 1.26, 0.235]);
  }, []);
  // Terminal flicker: ambient, uniform, meaningless. Off under reduced motion.
  useFrame(({ clock }) => {
    const m = screenMat.current;
    if (!m) return;
    const t = clock.elapsedTime;
    m.emissiveIntensity = reduced ? 0.55 : 0.5 + 0.08 * Math.sin(t * 7.3) * Math.sin(t * 1.7) + 0.03 * Math.sin(t * 23);
  });
  return (
    <group>
      <instancedMesh ref={desks} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[1.9, 0.08, 0.8]} />
        <meshStandardMaterial color={P.steelLit} roughness={0.85} metalness={0.25} />
      </instancedMesh>
      <instancedMesh ref={legs} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[1.7, 0.9, 0.12]} />
        <meshStandardMaterial color={P.steel} roughness={0.9} metalness={0.2} />
      </instancedMesh>
      <instancedMesh ref={seats} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[0.62, 0.56, 0.6]} />
        <meshStandardMaterial color={P.cloth} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={bodies} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[0.72, 0.46, 0.06]} />
        <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.3} />
      </instancedMesh>
      <instancedMesh ref={screens} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[0.62, 0.36, 0.01]} />
        <meshStandardMaterial ref={screenMat} color="#07141a" emissive={P.crt} emissiveIntensity={0.55} roughness={0.4} />
      </instancedMesh>
    </group>
  );
}

/** The Lab bay: glass toward the chamber, benches, a tall apparatus. Screens live with the Alchemist. */
function LabBay({ onPick }: { onPick: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group position={[-11, 0, 1]} onPointerDown={onPick}>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[6.4, 0.1, 7.4]} />
        <meshStandardMaterial color={P.concreteDark} roughness={1} />
      </mesh>
      {/* solid back and outer walls */}
      <mesh position={[0, 1.9, -3.7]}>
        <boxGeometry args={[6.4, 3.8, 0.2]} />
        <meshStandardMaterial color={P.steel} roughness={0.9} metalness={0.2} />
      </mesh>
      <mesh position={[-3.2, 1.9, 0]}>
        <boxGeometry args={[0.2, 3.8, 7.4]} />
        <meshStandardMaterial color={P.steel} roughness={0.9} metalness={0.2} />
      </mesh>
      {/* glass toward the chamber and toward the gallery */}
      <mesh position={[3.15, 1.9, 0]}>
        <boxGeometry args={[0.06, 3.6, 7.2]} />
        <meshStandardMaterial color={P.glass} transparent opacity={0.12} roughness={0.1} metalness={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.9, 3.7]}>
        <boxGeometry args={[6.4, 3.6, 0.06]} />
        <meshStandardMaterial color={P.glass} transparent opacity={0.12} roughness={0.1} metalness={0.1} depthWrite={false} />
      </mesh>
      {/* roof beam */}
      <mesh position={[0, 3.75, 0]}>
        <boxGeometry args={[6.4, 0.16, 7.4]} />
        <meshStandardMaterial color={P.steel} roughness={0.9} metalness={0.2} />
      </mesh>
      {/* benches */}
      <mesh position={[-1.6, 0.55, 0.6]}>
        <boxGeometry args={[2.4, 0.9, 0.8]} />
        <meshStandardMaterial color={P.steelLit} roughness={0.8} metalness={0.3} />
      </mesh>
      <mesh position={[-1.6, 0.55, -1.9]}>
        <boxGeometry args={[2.4, 0.9, 0.8]} />
        <meshStandardMaterial color={P.steelLit} roughness={0.8} metalness={0.3} />
      </mesh>
      {/* apparatus column */}
      <group position={[-2.2, 0, -2.9]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.55, 0.6, 0.3, 8]} />
          <meshStandardMaterial color={P.steel} roughness={0.8} metalness={0.4} />
        </mesh>
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.18, 0.2, 2.3, 6]} />
          <meshStandardMaterial color={P.steelLit} roughness={0.6} metalness={0.5} />
        </mesh>
        <mesh position={[0, 2.75, 0]}>
          <cylinderGeometry args={[0.5, 0.5, 0.14, 8]} />
          <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

/** Operations: one ordered console, a rack column, a low partition. Screens and LEDs live with the Warden. */
function OpsBay({ onPick }: { onPick: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group position={[11, 0, 0.6]} onPointerDown={onPick}>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[6.4, 0.1, 7.4]} />
        <meshStandardMaterial color={P.concreteDark} roughness={1} />
      </mesh>
      {/* low partition toward the chamber */}
      <mesh position={[-3.1, 0.6, 0]}>
        <boxGeometry args={[0.18, 1.1, 7.2]} />
        <meshStandardMaterial color={P.steel} roughness={0.9} metalness={0.2} />
      </mesh>
      {/* console */}
      <mesh position={[0, 0.5, -0.4]}>
        <boxGeometry args={[5.2, 0.9, 0.9]} />
        <meshStandardMaterial color={P.steelLit} roughness={0.75} metalness={0.35} />
      </mesh>
      {/* rack column */}
      <mesh position={[2.4, 1.6, -3.0]}>
        <boxGeometry args={[1.2, 3.2, 1.1]} />
        <meshStandardMaterial color={P.steel} roughness={0.7} metalness={0.4} />
      </mesh>
      {/* back wall */}
      <mesh position={[0, 1.9, -3.7]}>
        <boxGeometry args={[6.4, 3.8, 0.2]} />
        <meshStandardMaterial color={P.steel} roughness={0.9} metalness={0.2} />
      </mesh>
    </group>
  );
}

export function Architecture({ onPick, reduced }: { onPick: (f: Figure) => void; reduced: boolean }) {
  const pick = (f: Figure) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onPick(f);
  };
  return (
    <group>
      {/* floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color={P.floor} roughness={1} />
      </mesh>
      {/* back wall and pilasters — the large negative space above is the point */}
      <mesh position={[0, 5.5, -9.5]}>
        <boxGeometry args={[34, 11, 0.6]} />
        <meshStandardMaterial color={P.wall} roughness={0.95} metalness={0.1} />
      </mesh>
      {[-6.5, 6.5].map((x) => (
        <mesh key={x} position={[x, 5.5, -9.1]}>
          <boxGeometry args={[0.9, 11, 0.5]} />
          <meshStandardMaterial color={P.steel} roughness={0.9} metalness={0.2} />
        </mesh>
      ))}
      {/* dais: two modest steps */}
      <group onPointerDown={pick("SATOSHI")}>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[3.4, 3.4, 0.28, 12]} />
          <meshStandardMaterial color={P.concrete} roughness={1} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[2.5, 2.5, 0.28, 12]} />
          <meshStandardMaterial color={P.concrete} roughness={1} />
        </mesh>
      </group>
      <Stations reduced={reduced} />
      <LabBay onPick={pick("ALCHEMIST")} />
      <OpsBay onPick={pick("WARDEN")} />
      {/* observation-gallery rail in the foreground */}
      <group position={[0, 7.0, 14.6]}>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[14, 0.06, 0.06]} />
          <meshStandardMaterial color={P.steelLit} roughness={0.6} metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.0, 0]}>
          <boxGeometry args={[14, 0.04, 0.04]} />
          <meshStandardMaterial color={P.steel} roughness={0.6} metalness={0.6} />
        </mesh>
        {[-6.8, -3.4, 0, 3.4, 6.8].map((x) => (
          <mesh key={x} position={[x, -0.2, 0]}>
            <boxGeometry args={[0.06, 1.4, 0.06]} />
            <meshStandardMaterial color={P.steel} roughness={0.6} metalness={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
