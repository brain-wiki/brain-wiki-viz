import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TILT } from "../layout";
import { zoomAt } from "./zoom";

describe("zoom toward the cursor", () => {
  const target = new THREE.Vector3(100, 37, -900);
  const view = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));
  const start = target.clone().addScaledVector(view, 200);
  // A cursor near the top of the screen: the ray tips farther from the camera than the view axis.
  const ray = view.clone().negate().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.25).normalize();

  it("keeps the target on the map and the point under the cursor in place, down to the minimum", () => {
    let cam = { pos: start, target };
    const under = start.clone().addScaledVector(ray, (target.y - start.y) / ray.y);
    for (let i = 0; i < 200; i++) {
      cam = zoomAt(cam.pos, cam.target, ray, 0.9, 4, 1000);
      expect(cam.target.y).toBeCloseTo(target.y, 6);
      expect(under.clone().sub(cam.pos).normalize().dot(ray)).toBeCloseTo(1, 6);
    }
    expect(cam.pos.distanceTo(cam.target)).toBeCloseTo(4, 6);
    expect(cam.target.distanceTo(under)).toBeLessThan(5);
  });

  it("zooms toward the target when the cursor is above the horizon", () => {
    const sky = new THREE.Vector3(0, 0.2, -1).normalize();
    const next = zoomAt(start, target, sky, 0.5, 4, 1000);
    expect(next.target.distanceTo(target)).toBeCloseTo(0, 6);
    expect(next.pos.distanceTo(target)).toBeCloseTo(100, 6);
  });
});
