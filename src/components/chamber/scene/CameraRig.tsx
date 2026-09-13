import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Station } from "@/lib/chamber/states.ts";

type Pose = { pos: [number, number, number]; target: [number, number, number] };

/** Landscape framings: an elevated observation gallery, then the three destinations. */
const LANDSCAPE: Record<Station, Pose> = {
  OVERVIEW: { pos: [0, 9.6, 19.5], target: [0, 1.4, -0.5] },
  DAIS: { pos: [0.6, 3.0, 6.8], target: [0, 1.5, -0.9] },
  LAB: { pos: [-6.2, 3.2, 8.2], target: [-10.6, 1.4, 0.8] },
  OPS: { pos: [6.2, 3.2, 8.2], target: [10.8, 1.4, 0.4] },
};
/** Portrait phones pull back so the horseshoe and both wings still fit. */
const PORTRAIT: Record<Station, Pose> = {
  OVERVIEW: { pos: [0, 13.0, 27.5], target: [0, 1.2, -0.5] },
  DAIS: { pos: [0.4, 3.4, 8.8], target: [0, 1.5, -0.9] },
  LAB: { pos: [-5.8, 3.6, 10.8], target: [-10.6, 1.4, 0.8] },
  OPS: { pos: [5.8, 3.6, 10.8], target: [10.8, 1.4, 0.4] },
};

/** Slow, deliberate, heavy: a per-second damping rate, not a tween. */
const LAMBDA = 1.5;

export function CameraRig({ station, reduced }: { station: Station; reduced: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const look = useRef(new THREE.Vector3(0, 1.4, -0.5));
  const goalPos = useRef(new THREE.Vector3());
  const goalLook = useRef(new THREE.Vector3());
  const first = useRef(true);

  useEffect(() => {
    invalidate();
  }, [station, reduced, invalidate]);

  useFrame((_, dt) => {
    const pose = (size.height > size.width ? PORTRAIT : LANDSCAPE)[station];
    goalPos.current.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    goalLook.current.set(pose.target[0], pose.target[1], pose.target[2]);
    if (reduced || first.current) {
      // prefers-reduced-motion: cut, never travel.
      camera.position.copy(goalPos.current);
      look.current.copy(goalLook.current);
      camera.lookAt(look.current);
      first.current = false;
      return;
    }
    const d = Math.min(dt, 0.1);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, goalPos.current.x, LAMBDA, d);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, goalPos.current.y, LAMBDA, d);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, goalPos.current.z, LAMBDA, d);
    look.current.x = THREE.MathUtils.damp(look.current.x, goalLook.current.x, LAMBDA, d);
    look.current.y = THREE.MathUtils.damp(look.current.y, goalLook.current.y, LAMBDA, d);
    look.current.z = THREE.MathUtils.damp(look.current.z, goalLook.current.z, LAMBDA, d);
    camera.lookAt(look.current);
    const remaining = camera.position.distanceTo(goalPos.current) + look.current.distanceTo(goalLook.current);
    if (remaining > 0.004) invalidate();
  });
  return null;
}
