// Deterministic, local layouts (design doc 12 §3): the same brain always draws the same map,
// and no layout spans the whole brain.
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

/** Camera tilt from straight down, in radians. The map is 2.5D: fixed tilt and heading. */
export const TILT = 0.68;
/** From what the camera looks at toward the camera. */
export const VIEW: [number, number, number] = [0, Math.cos(TILT), Math.sin(TILT)];
/** Up on screen: with `x`, the plane that faces the camera. */
export const SCREEN_UP: [number, number, number] = [0, Math.sin(TILT), -Math.cos(TILT)];

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
  /** Per skeleton vertex, how far along its line it is: 1 at the parent end, 0 at the child. */
  skeletonShade: Float32Array;
}

export interface Branch {
  key: string; // folder path relative to the topic folder; "" is the topic itself
  parent: string | null;
  title: string; // the folder note's title, else the folder name
  label: string; // the title without what its parent folders already say (the map's label)
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
 * A folder's title without the leading " · " parts its parent folders' titles already say, so a
 * generated title like "Lumen guide · Sync · Conflicts" labels its star "Conflicts".
 */
function shortLabel(b: Branch, branches: Map<string, Branch>): string {
  const said = new Set<string>();
  for (let p = b.parent === null ? undefined : branches.get(b.parent); p; p = p.parent === null ? undefined : branches.get(p.parent)) {
    for (const part of p.title.split(" · ")) said.add(part.trim().toLowerCase());
  }
  const parts = b.title.split(" · ");
  while (parts.length > 1 && said.has(parts[0].trim().toLowerCase())) parts.shift();
  return parts.join(" · ");
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
  branches.set("", { key: "", parent: null, title: topic.title, label: topic.title, note: topic.hub, depth: 0, count: 0 });
  const ensure = (key: string): Branch => {
    let b = branches.get(key);
    if (!b) {
      const cut = key.lastIndexOf("/");
      const parent = cut < 0 ? "" : key.slice(0, cut);
      const p = ensure(parent);
      const name = key.slice(cut + 1);
      b = { key, parent, title: name, label: name, note: null, depth: p.depth + 1, count: 0 };
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
  for (const b of branches.values()) b.label = shortLabel(b, branches);
  return { branches, folderOf };
}

/**
 * Notes of one topic, placed as a radial tree of its folders (design doc 12 §3). Each folder gets
 * a slice of the circle sized by the notes below it, and its children split that slice: so a
 * folder's notes and sub-folders stay inside its slice and tree lines cannot cross. The tree faces
 * the camera, and nesting is distance twice over: a folder sits one ring farther out than its parent
 * and one tier farther back, straight along the view, so depth never moves a star on screen. A
 * folder's own notes fan out just beyond its star, in rows when they are many.
 * Typed links are drawn but do not move stars. Deterministic: the same topic always draws the same.
 */
export function topicLayout(topic: TopicData, radius: number): StarPlacement {
  const r = rng(`n:${topic.slug}`);
  const { branches, folderOf } = folderTree(topic);
  const anchor = (key: string) => branches.get(key)!.note ?? `branch:${key}`;
  const children = new Map<string, string[]>();
  for (const b of branches.values()) {
    if (b.parent !== null) children.set(b.parent, [...(children.get(b.parent) ?? []), b.key]);
  }
  const own = new Map<string, string[]>(); // a folder's notes, without its folder note
  for (const [id, key] of folderOf) {
    if (id === branches.get(key)!.note) continue;
    own.set(key, [...(own.get(key) ?? []), id]);
  }
  const weights = new Map<string, number>();
  const weight = (key: string): number => {
    let w = weights.get(key);
    if (w === undefined) {
      w = (own.get(key)?.length ?? 0) + (children.get(key) ?? []).reduce((s, k) => s + weight(k), 0);
      w = Math.max(1, w);
      weights.set(key, w);
    }
    return w;
  };
  const RING = 1; // distance between nesting levels
  const TIER = 0.45; // how much farther from the camera each nesting level sits
  const GAP = 0.3; // spacing between a folder's notes along an arc
  const ROW = 0.32; // spacing between rows of notes
  const at = (angle: number, rad: number, depth: number): [number, number, number] => {
    const across = rad * Math.cos(angle);
    const up = rad * Math.sin(angle);
    const back = depth * TIER;
    return [across - VIEW[0] * back, up * SCREEN_UP[1] - VIEW[1] * back, up * SCREEN_UP[2] - VIEW[2] * back];
  };
  const pos = new Map<string, [number, number, number]>();
  const polar = new Map<string, [number, number, number]>(); // angle, ring radius, depth
  const put = (id: string, angle: number, rad: number, depth: number) => {
    polar.set(id, [angle, rad, depth]);
    pos.set(id, at(angle, rad, depth));
  };
  const combed = new Set<string>(); // folders whose notes get elbows instead of straight lines
  const placeNotes = (key: string, ids: string[], a0: number, a1: number, depth: number) => {
    // A straight line from the star dips inside the folder's ring when its note sits too far
    // round; the ring carries the folder's elbows, so such a folder's notes take elbows too.
    const ring = (depth - 1) * RING;
    if (ring > 0 && (a1 - a0) / 2 > 0.9 * Math.acos(ring / (ring + RING))) combed.add(key);
    for (let i = 0, row = 0; i < ids.length; row++) {
      const rad = depth * RING + row * ROW;
      const take = Math.min(ids.length - i, Math.max(1, Math.floor(((a1 - a0) * rad) / GAP)));
      for (let j = 0; j < take; j++) {
        const angle = a0 + ((a1 - a0) * (j + 0.5 + (r() - 0.5) * 0.3)) / take;
        put(ids[i + j], angle, rad + (r() - 0.5) * ROW * 0.3, depth);
      }
      i += take;
    }
  };
  const place = (key: string, a0: number, a1: number) => {
    const b = branches.get(key)!;
    // The folder's notes go straight out from its star, its sub-folders to either side.
    const subs = children.get(key) ?? [];
    const half = Math.ceil(subs.length / 2);
    const notes = own.get(key) ?? [];
    const parts: { w: number; notes: boolean; go: (s: number, e: number) => void }[] = [
      ...subs.slice(0, half).map((k) => ({ w: weight(k), notes: false, go: (s: number, e: number) => place(k, s, e) })),
      ...(notes.length
        ? [{ w: notes.length, notes: true, go: (s: number, e: number) => placeNotes(key, notes, s, e, b.depth + 1) }]
        : []),
      ...subs.slice(half).map((k) => ({ w: weight(k), notes: false, go: (s: number, e: number) => place(k, s, e) })),
    ];
    const total = parts.reduce((s, part) => s + part.w, 0);
    let a = a0;
    let star = (a0 + a1) / 2;
    const spans = parts.map((part) => {
      const span: [number, number] = [a, a + ((a1 - a0) * part.w) / total];
      if (part.notes) star = (span[0] + span[1]) / 2; // the star faces its own notes
      a = span[1];
      return span;
    });
    if (key === "") {
      polar.set(anchor(key), [star, 0, 0]);
      pos.set(anchor(key), [0, 0, 0]);
    } else put(anchor(key), star, b.depth * RING, b.depth);
    parts.forEach((part, i) => part.go(...spans[i]));
  };
  const start = r() * Math.PI * 2;
  place("", start, start + Math.PI * 2);

  let max = 1e-6;
  for (const p of pos.values()) max = Math.max(max, Math.hypot(...p));
  const scale = (radius * 0.85) / max;
  const pointOf = (id: string): [number, number, number] => {
    const p = pos.get(id)!;
    return [p[0] * scale, p[1] * scale, p[2] * scale];
  };
  const ids = [...folderOf.keys()].filter((id) => pos.has(id)).sort((a, b) => Number(b === topic.hub) - Number(a === topic.hub));
  const positions = new Float32Array(ids.length * 3);
  ids.forEach((id, i) => positions.set(pointOf(id), i * 3));
  const ordered = [...branches.values()].sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
  // Folder-to-folder lines are radial elbows: along the parent's own ring to the child's angle,
  // then straight out. A folder's notes keep straight lines from its star, which leave the ring at
  // once, so the two can only meet at the star; slices keep different folders apart.
  const segments: number[] = [];
  const shade: number[] = [];
  const curve = (from: string, to: string) => {
    const [a0, r0, d0] = polar.get(from)!;
    const [a1, r1, d1] = polar.get(to)!;
    const path: [number, number, number][] = [[a0, r0, d0]];
    if (r0 > 0) {
      // A shared angular grid, so siblings leaving one star along its ring draw the same arc.
      const STEP = 0.08;
      const dir = Math.sign(a1 - a0);
      for (let g = Math.floor(a0 / STEP) + (dir > 0 ? 1 : 0); dir * (g * STEP - a1) < 0; g += dir) {
        path.push([g * STEP, r0, d0]);
      }
      path.push([a1, r0, d0]);
    }
    path.push([a1, r1, d1]);
    const points = path.map(([a, rad, d]) => at(r0 === 0 ? a1 : a, rad, d).map((v) => v * scale));
    const lengths = points.slice(1).map((q, k) => Math.hypot(q[0] - points[k][0], q[1] - points[k][1], q[2] - points[k][2]));
    const total = lengths.reduce((s, l) => s + l, 0) || 1;
    let done = 0;
    for (let k = 1; k < points.length; k++) {
      segments.push(...points[k - 1], ...points[k]);
      shade.push(1 - done / total, 1 - (done + lengths[k - 1]) / total);
      done += lengths[k - 1];
    }
  };
  for (const b of ordered) {
    if (b.key !== "") curve(anchor(b.parent!), anchor(b.key));
  }
  for (const [id, key] of folderOf) {
    if (key === "" || id === branches.get(key)!.note) continue;
    if (combed.has(key)) {
      curve(anchor(key), id);
      continue;
    }
    segments.push(...pointOf(anchor(key)), ...pointOf(id));
    shade.push(1, 0);
  }
  const placedBranches = ordered.filter((b) => b.key !== "").map((b) => ({ ...b, position: pointOf(anchor(b.key)) }));
  return {
    ids,
    positions,
    branches: placedBranches,
    skeleton: new Float32Array(segments),
    skeletonShade: new Float32Array(shade),
  };
}
