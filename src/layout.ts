// Deterministic, local layouts (design doc 12 §3): the same brain always draws the same map,
// and no layout spans the whole brain.
import { forceLink, forceManyBody, forceRadial, forceSimulation, type SimNode } from "d3-force-3d";
import type { Constellation, TopicData, TopicSummary } from "./types";
import { rng } from "./util/rand";

export interface Placed {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface GalaxyLayout {
  constellations: Map<string, Placed>;
  topics: Map<string, Placed>;
  inbox: Placed;
  radius: number;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function topicRadius(notes: number): number {
  return 14 + 5.5 * Math.sqrt(Math.max(1, notes));
}

interface Disc {
  id: string;
  r: number;
  x: number;
  z: number;
}

/** Golden-angle spiral, then push overlapping discs apart (and out of an optional hole). */
function spiral(items: { id: string; r: number }[], gap: number, hole = 0): Disc[] {
  if (items.length === 0) return [];
  const mean = items.reduce((s, i) => s + i.r, 0) / items.length;
  const step = 2 * mean + gap;
  const discs = items.map((it, k) => {
    const rad = k === 0 && hole === 0 ? 0 : hole + step * Math.sqrt(k + (hole ? 0.6 : 0));
    const a = k * GOLDEN;
    return { id: it.id, r: it.r, x: rad * Math.cos(a), z: rad * Math.sin(a) };
  });
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i];
        const b = discs[j];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const min = a.r + b.r + gap;
        if (d < min) {
          if (d < 1e-6) {
            dx = 1;
            dz = 0;
            d = 1;
          }
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
          moved = true;
        }
      }
      if (hole) {
        const d = discs[i];
        const dist = Math.hypot(d.x, d.z) || 1;
        const min = hole + d.r;
        if (dist < min) {
          d.x *= min / dist;
          d.z *= min / dist;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return discs;
}

export function galaxyLayout(constellations: Constellation[], topics: TopicSummary[], inboxCount: number): GalaxyLayout {
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const local = new Map<string, Disc[]>();
  const cRadius = new Map<string, number>();
  for (const c of constellations) {
    const members = c.topics
      .map((s) => bySlug.get(s))
      .filter((t): t is TopicSummary => !!t)
      .sort((a, b) => b.notes - a.notes || a.slug.localeCompare(b.slug))
      .map((t) => ({ id: t.slug, r: topicRadius(t.notes) }));
    const discs = spiral(members, 18);
    const r = Math.max(60, ...discs.map((d) => Math.hypot(d.x, d.z) + d.r)) + 24;
    local.set(c.id, discs);
    cRadius.set(c.id, r);
  }
  const inbox: Placed = { x: 0, y: 0, z: 0, r: 26 + 4 * Math.sqrt(inboxCount) };
  const single = constellations.length <= 1;
  const placed = spiral(
    constellations.map((c) => ({ id: c.id, r: cRadius.get(c.id) ?? 60 })),
    single ? 0 : 70,
    single ? 0 : inbox.r + 90,
  );
  const out: GalaxyLayout = { constellations: new Map(), topics: new Map(), inbox, radius: 0 };
  for (const p of placed) {
    const r = rng(`c:${p.id}`);
    const cy = single ? 0 : (r() - 0.5) * 0.3 * p.r;
    out.constellations.set(p.id, { x: p.x, y: cy, z: p.z, r: p.r });
    // Each constellation is a slightly tilted disc, so the galaxy has depth.
    const tilt = (r() - 0.5) * 0.7;
    const spin = r() * Math.PI * 2;
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    for (const d of local.get(p.id) ?? []) {
      const tr = rng(`t:${d.id}`);
      const lx = d.x * cs - d.z * sn;
      const lz = d.x * sn + d.z * cs;
      const ly = Math.sin(tilt) * lx + (tr() - 0.5) * 0.35 * d.r;
      out.topics.set(d.id, { x: p.x + lx * Math.cos(tilt), y: cy + ly, z: p.z + lz, r: d.r });
    }
    out.radius = Math.max(out.radius, Math.hypot(p.x, p.z) + p.r);
  }
  out.radius = Math.max(out.radius, inbox.r * 3);
  if (single) {
    // One constellation: keep the inbox beside it instead of under it.
    const c = [...out.constellations.values()][0];
    if (c) {
      inbox.x = c.x + c.r + inbox.r + 60;
      out.radius = Math.max(out.radius, c.r + 2 * inbox.r + 60);
    }
  }
  return out;
}

export interface StarPlacement {
  ids: string[];
  positions: Float32Array; // local to the topic centre
}

/** Notes of one topic around its hub: a small seeded force simulation, scaled into the nebula. */
export function topicLayout(topic: TopicData, radius: number): StarPlacement {
  const r = rng(`n:${topic.slug}`);
  type N = SimNode & { hub: boolean };
  const nodes: N[] = topic.nodes.map((n) => {
    const hub = n.id === topic.hub;
    const u = r() * 2 - 1;
    const phi = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const d = radius * (0.35 + 0.5 * r());
    return hub
      ? { id: n.id, hub, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0 }
      : { id: n.id, hub, x: d * s * Math.cos(phi), y: d * u * 0.6, z: d * s * Math.sin(phi) };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const links = topic.links
    .filter((l) => l.rel !== "links_to" && l.rel !== "part_of" && l.rel !== "has_part")
    .filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target }));
  const n = nodes.length;
  if (n > 1) {
    const sim = forceSimulation(nodes, 3)
      .force("charge", forceManyBody().strength(-radius * 0.6).distanceMax(radius * 2))
      .force(
        "link",
        forceLink(links)
          .id((d) => d.id)
          .distance(radius * 0.3)
          .strength(0.12),
      )
      .force("radial", forceRadial(radius * 0.55).strength(0.1))
      .stop();
    sim.tick(n <= 150 ? 220 : n <= 600 ? 150 : 90);
  }
  let max = 1e-6;
  for (const node of nodes) max = Math.max(max, Math.hypot(node.x ?? 0, (node.y ?? 0) / 0.65, node.z ?? 0));
  const scale = (radius * 0.85) / max;
  const positions = new Float32Array(n * 3);
  nodes.forEach((node, i) => {
    positions[i * 3] = (node.x ?? 0) * scale;
    positions[i * 3 + 1] = (node.y ?? 0) * scale * 0.65;
    positions[i * 3 + 2] = (node.z ?? 0) * scale;
  });
  return { ids: nodes.map((x) => x.id), positions };
}
