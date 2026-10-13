// Deterministic, local layouts (design doc 12 §3): the same brain always draws the same map,
// and no layout spans the whole brain.
import { forceLink, forceManyBody, forceSimulation, type SimNode } from "d3-force-3d";
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
    const found = c.topics.map((s) => bySlug.get(s)).filter((t): t is TopicSummary => !!t);
    const inside = new Set(found.map((t) => t.slug));
    const tops = found.filter((t) => !t.parent || !inside.has(t.parent));
    const root = found.length > 1 && tops.length === 1 ? tops[0].slug : null; // a topic and its sub-topics
    const members = found
      .sort((a, b) => Number(b.slug === root) - Number(a.slug === root) || b.notes - a.notes || a.slug.localeCompare(b.slug))
      .map((t) => ({ id: t.slug, r: topicRadius(t.notes) })); // the spiral puts the first at the centre
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
  /** The topic's folder tree: one entry per sub-folder (the topic itself is not one). */
  branches: BranchPlacement[];
  /** Faint tree lines as segment pairs: each branch to its parent, each note to its branch. */
  skeleton: Float32Array;
}

export interface Branch {
  key: string; // folder path relative to the topic folder; "" is the topic itself
  parent: string | null;
  title: string; // the folder note's title, else the folder name
  note: string | null; // the folder note: the branch's star; null when the folder has none
  depth: number;
  count: number; // notes in the folder and everything below it
}

export interface BranchPlacement extends Branch {
  position: [number, number, number];
}

export interface FolderTree {
  branches: Map<string, Branch>;
  folderOf: Map<string, string>; // note id -> the branch it sits in (a folder note: its own)
}

const FOLDER_NOTES = new Set(["index", "_index", "readme"]);

/** The folder a topic lives in: as the server says, else its hub's folder, else the common one. */
export function topicFolder(topic: TopicData): string {
  if (topic.path) return topic.path;
  const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const hub = topic.nodes.find((n) => n.id === topic.hub);
  if (hub) return dir(hub.path);
  const dirs = topic.nodes.map((n) => dir(n.path).split("/"));
  if (!dirs.length) return "";
  const common: string[] = [];
  for (let i = 0; dirs.every((d) => d[i] !== undefined && d[i] === dirs[0][i]); i++) common.push(dirs[0][i]);
  return common.join("/");
}

/**
 * The folder tree inside a topic (design doc 12 §3): the map's hierarchy always follows the
 * folders, as Obsidian shows them. A sub-folder is a branch; its folder note (`x/x.md`,
 * `x/index.md`, `x/readme.md`) is the branch's star.
 */
export function folderTree(topic: TopicData): FolderTree {
  const root = topicFolder(topic);
  const prefix = root ? `${root}/` : "";
  const branches = new Map<string, Branch>();
  branches.set("", { key: "", parent: null, title: topic.title, note: topic.hub, depth: 0, count: 0 });
  const ensure = (key: string): Branch => {
    let b = branches.get(key);
    if (!b) {
      const cut = key.lastIndexOf("/");
      const parent = cut < 0 ? "" : key.slice(0, cut);
      const p = ensure(parent);
      const name = key.slice(cut + 1);
      b = { key, parent, title: name, note: null, depth: p.depth + 1, count: 0 };
      branches.set(key, b);
    }
    return b;
  };
  const folderOf = new Map<string, string>();
  const notes = [...topic.nodes].filter((n) => n.kind !== "episode").sort((a, b) => a.path.localeCompare(b.path));
  for (const n of notes) {
    const rel = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.path;
    const cut = rel.lastIndexOf("/");
    const key = cut < 0 ? "" : rel.slice(0, cut);
    const branch = ensure(key);
    const stem = rel.slice(cut + 1).replace(/\.md$/i, "").toLowerCase();
    const folder = key.slice(key.lastIndexOf("/") + 1).toLowerCase();
    if (key && !branch.note && (stem === folder || FOLDER_NOTES.has(stem))) {
      branch.note = n.id;
      branch.title = n.title;
    }
    folderOf.set(n.id, key);
  }
  for (const key of folderOf.values()) {
    for (let b = branches.get(key); b; b = b.parent === null ? undefined : branches.get(b.parent)) b.count++;
  }
  return { branches, folderOf };
}

/**
 * Notes of one topic, placed by their folder tree: the hub at the centre, each branch in its own
 * direction, and each note around its branch's star. Tree springs are strong and typed links weak,
 * so related notes lean together without leaving their folder. Seeded, so the same topic always
 * draws the same way; scaled into the nebula.
 */
export function topicLayout(topic: TopicData, radius: number): StarPlacement {
  const r = rng(`n:${topic.slug}`);
  const { branches, folderOf } = folderTree(topic);
  const total = Math.max(1, branches.get("")!.count);
  const anchor = (key: string) => branches.get(key)!.note ?? `branch:${key}`;
  type N = SimNode & { note: boolean };
  const nodes = new Map<string, N>();
  const direction = (): [number, number, number] => {
    const u = r() * 2 - 1;
    const phi = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return [s * Math.cos(phi), u * 0.6, s * Math.sin(phi)];
  };
  const reach = (b: Branch) => radius * (0.14 + 0.32 * Math.sqrt(b.count / total)) * Math.pow(0.8, b.depth - 1);
  const spread = (b: Branch) => (b.key === "" ? radius * 0.45 : radius * (0.05 + 0.12 * Math.sqrt(b.count / total)));

  // Branches first, parents before children, each starting out along its own direction.
  const ordered = [...branches.values()].sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
  const at = new Map<string, [number, number, number]>([["", [0, 0, 0]]]);
  const topLevel = ordered.filter((b) => b.depth === 1).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  topLevel.forEach((b, k) => {
    const y = 1 - (2 * (k + 0.5)) / topLevel.length;
    const ring = Math.sqrt(1 - y * y);
    const a = k * GOLDEN;
    at.set(b.key, [ring * Math.cos(a), y * 0.6, ring * Math.sin(a)]);
  });
  for (const b of ordered) {
    if (b.key === "") {
      const id = anchor("");
      nodes.set(id, { id, note: b.note !== null, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0 });
      continue;
    }
    const parent = branches.get(b.parent!)!;
    const base = nodes.get(anchor(parent.key))!;
    const dir = b.depth === 1 ? at.get(b.key)! : direction();
    const d = reach(b);
    const id = anchor(b.key);
    nodes.set(id, { id, note: b.note !== null, x: (base.x ?? 0) + dir[0] * d, y: (base.y ?? 0) + dir[1] * d, z: (base.z ?? 0) + dir[2] * d });
  }
  const tree: { source: string; target: string; distance: number; strength: number }[] = [];
  for (const b of ordered) {
    if (b.key !== "") tree.push({ source: anchor(b.key), target: anchor(b.parent!), distance: reach(b), strength: 0.9 });
  }
  for (const [id, key] of folderOf) {
    if (nodes.has(id)) continue; // a folder note is its branch's point
    const b = branches.get(key)!;
    const base = nodes.get(anchor(key))!;
    const dir = direction();
    const d = spread(b) * (0.6 + 0.6 * r());
    nodes.set(id, { id, note: true, x: (base.x ?? 0) + dir[0] * d, y: (base.y ?? 0) + dir[1] * d, z: (base.z ?? 0) + dir[2] * d });
    tree.push({ source: id, target: anchor(key), distance: spread(b), strength: key === "" ? 0.08 : 0.7 });
  }
  const all = [...nodes.values()];
  const typed = topic.links
    .filter((l) => l.rel !== "links_to" && l.rel !== "part_of" && l.rel !== "has_part")
    .filter((l) => nodes.has(l.source) && nodes.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target, distance: radius * 0.3, strength: 0.04 }));
  if (all.length > 1) {
    const links = [...tree, ...typed];
    const sim = forceSimulation(all, 3)
      .force("charge", forceManyBody().strength(-radius * 0.3).distanceMax(radius * 0.8))
      .force(
        "link",
        forceLink(links)
          .id((d) => d.id)
          .distance((l) => (l as (typeof links)[number]).distance)
          .strength((l) => (l as (typeof links)[number]).strength),
      )
      .stop();
    sim.tick(all.length <= 150 ? 220 : all.length <= 600 ? 150 : 90);
  }
  let max = 1e-6;
  for (const node of all) max = Math.max(max, Math.hypot(node.x ?? 0, (node.y ?? 0) / 0.65, node.z ?? 0));
  const scale = (radius * 0.85) / max;
  const place = (node: N): [number, number, number] => [(node.x ?? 0) * scale, (node.y ?? 0) * scale * 0.65, (node.z ?? 0) * scale];
  const ids = [...folderOf.keys()].filter((id) => nodes.has(id)).sort((a, b) => Number(b === topic.hub) - Number(a === topic.hub));
  const positions = new Float32Array(ids.length * 3);
  ids.forEach((id, i) => positions.set(place(nodes.get(id)!), i * 3));
  const pointOf = (id: string) => place(nodes.get(id)!);
  const segments: number[] = [];
  for (const b of ordered) {
    if (b.key !== "") segments.push(...pointOf(anchor(b.key)), ...pointOf(anchor(b.parent!)));
  }
  for (const [id, key] of folderOf) {
    if (key !== "" && id !== branches.get(key)!.note) segments.push(...pointOf(id), ...pointOf(anchor(key)));
  }
  const placedBranches = ordered
    .filter((b) => b.key !== "")
    .map((b) => ({ ...b, position: pointOf(anchor(b.key)) }));
  return { ids, positions, branches: placedBranches, skeleton: new Float32Array(segments) };
}
