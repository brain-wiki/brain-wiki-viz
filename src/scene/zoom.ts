import * as THREE from "three";

/**
 * One zoom step toward the cursor on a map seen at a fixed tilt: scale the camera and its target
 * about the point under the cursor on the target's level plane. The target never leaves that
 * plane, so the camera keeps closing in on the map; zooming about a point in the screen plane
 * instead lifts the target off the map, and the zoom stalls at its minimum distance in empty
 * space. `ray` is the unit direction from the camera through the cursor.
 */
export function zoomAt(
  pos: THREE.Vector3,
  target: THREE.Vector3,
  ray: THREE.Vector3,
  scale: number,
  min: number,
  max: number,
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const dist = pos.distanceTo(target);
  const s = Math.min(max, Math.max(min, dist * scale)) / dist;
  const t = ray.y < -1e-6 ? (target.y - pos.y) / ray.y : -1;
  // At or above the horizon there is no map under the cursor: zoom toward the target.
  const p = t > 0 && t < max * 2 ? pos.clone().addScaledVector(ray, t) : target.clone();
  return {
    pos: p.clone().addScaledVector(pos.clone().sub(p), s),
    target: p.clone().addScaledVector(target.clone().sub(p), s),
  };
}
