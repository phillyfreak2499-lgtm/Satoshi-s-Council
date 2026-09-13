import { useLayoutEffect, useRef } from "react";
import type { SpotLight } from "three";
import type { Accent } from "@/lib/chamber/states.ts";

/**
 * Cold, dim, institutional — but readable. Four fixed lights carry the room: a
 * hemisphere fill, one high cold key, a low fill from the gallery side so the
 * horseshoe reads from the overview, and one narrow spot over the dais. On desktop
 * two low point lights let the Lab and Operations bleed their semantic colour onto
 * the floor. Intensities are three's physical units (r155+). No shadows in Phase 0:
 * contact is faked by dark plinths, which reads as baked.
 */
export function Lighting({ mobile, lab, ops }: { mobile: boolean; lab: Accent; ops: Accent }) {
  const spot = useRef<SpotLight>(null);
  useLayoutEffect(() => {
    const s = spot.current;
    if (!s) return;
    s.target.position.set(0, 1.0, -0.9);
    s.target.updateMatrixWorld();
  }, []);
  return (
    <>
      <hemisphereLight args={["#7c8aa3", "#05060a", 1.1]} />
      <directionalLight position={[8, 16, 10]} intensity={2.6} color="#aab6cc" />
      <directionalLight position={[0, 9, 20]} intensity={1.0} color="#7d879c" />
      <spotLight ref={spot} position={[0, 9.5, 2.5]} angle={0.38} penumbra={0.65} intensity={180} distance={24} decay={2} color="#c9d3e6" />
      {!mobile ? <pointLight position={[-11, 2.6, 1]} intensity={lab.intensity * 14} distance={10} decay={2} color={lab.hex} /> : null}
      {!mobile ? <pointLight position={[11, 2.6, 0.5]} intensity={ops.intensity * 14} distance={10} decay={2} color={ops.hex} /> : null}
    </>
  );
}
