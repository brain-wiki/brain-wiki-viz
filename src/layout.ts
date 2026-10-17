// Deterministic, local layouts (visualizer.md §3): the same brain always draws the same map,
// and no layout spans the whole brain.
import { packEnclose } from "d3-hierarchy";
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
  /** The folder tree: a line from each folder's core to its parent's, as segment pairs. */
  skeleton: Float32Array;
  /** Per skeleton vertex, how bright the line is there (0–1). */
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
  /** Where its label goes: just above its own topmost note. */
  position: [number, number, number];
  /** The disc its notes and sub-folders reach. */
  center: [number, number, number];
  radius: number;
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
 * The folder tree inside a topic (visualizer.md §3): the map's hierarchy always follows the
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
 * How much room a note gets on the map: its area grows with its length, gently (radius with the
 * fourth root of its lines), so long notes stand out without crowding out the short ones.
 */
export function noteWeight(lines: number): number {
  return Math.sqrt(Math.max(10, lines));
}

/** One folder's own notes, around its core note at the origin (unit space). */
interface Cluster {
  ids: string[];
  xy: Float64Array; // x, y per note
  r: number[]; // per note: how much room it takes
  radius: number;
}

const NOTE_GAP = 0.35; // between neighboring notes in a cluster, in unit space
const CORE = 1.2; // a cluster's core radius per mean note radius and √notes: dense, with room to settle
const HALO = 0.92; // the share of a folder's mass inside its outermost note

/**
 * One folder's own notes gathered by gravity: the core note at the center and the rest by length
 * on a projected Plummer profile, the shape a star cluster settles into. The core is dense and the
 * halo sparse, and long notes sink to the middle. Each note's direction is random (seeded by its
 * id), so the stars clump the way real ones do rather than spacing out evenly; linked notes then
 * pull together while gravity holds each at its depth in the cluster, and close neighbors push
 * apart.
 */
function gather(notes: { id: string; r: number }[], links: [number, number][]): Cluster {
  const n = notes.length;
  const mean = notes.reduce((s, x) => s + x.r, 0) / n;
  const a = CORE * mean * Math.sqrt(n);
  const depth = new Float64Array(n); // where gravity holds each note: its distance from the core
  const xy = new Float64Array(n * 2);
  notes.forEach((note, k) => {
    if (k === 0) return;
    const r = rng(`gather:${note.id}`);
    const u = ((k + 0.5) / n) * HALO;
    depth[k] = a * Math.sqrt(u / (1 - u)) * (0.8 + 0.4 * r());
    const t = r() * Math.PI * 2;
    xy[k * 2] = depth[k] * Math.cos(t);
    xy[k * 2 + 1] = depth[k] * Math.sin(t);
  });
  const push = (i: number, dx: number, dy: number) => {
    if (i === 0) return; // the core stays put
    xy[i * 2] += dx;
    xy[i * 2 + 1] += dy;
  };
  for (let iter = 0; iter < 50; iter++) {
    for (const [i, j] of links) {
      const dx = xy[j * 2] - xy[i * 2];
      const dy = xy[j * 2 + 1] - xy[i * 2 + 1];
      const d = Math.sqrt(dx * dx + dy * dy);
      const rest = notes[i].r + notes[j].r + 2 * NOTE_GAP;
      if (d <= rest) continue;
      const f = (0.08 * (d - rest)) / d;
      push(i, dx * f, dy * f);
      push(j, -dx * f, -dy * f);
    }
    for (let k = 1; k < n; k++) {
      const d = Math.hypot(xy[k * 2], xy[k * 2 + 1]);
      if (d > 1e-9) push(k, xy[k * 2] * 0.15 * (depth[k] / d - 1), xy[k * 2 + 1] * 0.15 * (depth[k] / d - 1));
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xy[j * 2] - xy[i * 2];
        let dy = xy[j * 2 + 1] - xy[i * 2 + 1];
        const min = notes[i].r + notes[j].r + NOTE_GAP;
        if (dx * dx + dy * dy >= min * min) continue;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-9) [dx, dy, d] = [Math.cos(j * GOLDEN), Math.sin(j * GOLDEN), 1];
        const share = i === 0 ? 1 : 0.5;
        push(i, (-dx / d) * (min - d) * share, (-dy / d) * (min - d) * share);
        push(j, (dx / d) * (min - d) * share, (dy / d) * (min - d) * share);
      }
    }
  }
  let radius = 0;
  notes.forEach((note, k) => (radius = Math.max(radius, Math.hypot(xy[k * 2], xy[k * 2 + 1]) + note.r)));
  return { ids: notes.map((x) => x.id), xy, r: notes.map((x) => x.r), radius };
}

/** A folder laid out on its own, before it knows where it sits (unit space). */
interface Body {
  key: string;
  depth: number;
  r: number; // how far its notes and sub-folders reach, from its center
  core: [number, number]; // where its links meet, from its center
  cluster: Cluster | null; // its own notes, around the core
  subs: { body: Body; x: number; y: number }[]; // its sub-folders, centers from the core
  free: number | null; // the direction, from the core, kept clear for the link from its parent
}

const FOLDER_GAP = 6; // between folders' clusters, in unit space: enough to read them apart
const JUNCTION = 1; // the room a folder with no notes of its own keeps at its core
const LINK_SHADE: [number, number] = [1, 0.7]; // a link, at its parent end and at its child end

/**
 * Sub-folders in orbit around a core of radius `core`, each a disc as wide as it reaches: each
 * gets a wedge of its own, as near the core as the wedges allow, the largest first and the rest
 * alternating to either side. A disc stays inside its wedge, so the straight line from the core
 * to it crosses no sibling.
 * With `inbound`, an empty wedge opposite the largest keeps the way in from the parent clear;
 * `free` is its direction.
 */
function orbit(core: number, radii: number[], inbound: boolean): { at: [number, number][]; free: number | null } {
  const n = radii.length;
  if (!n) return { at: [], free: null };
  const sizes = inbound ? [...radii, 0] : radii; // the way in: a wedge with nothing in it
  const dist = (r: number, ring: number) => Math.max(core + FOLDER_GAP + r, ring);
  const wedge = (r: number, ring: number) => 2 * Math.asin(Math.min(1, (r + FOLDER_GAP / 2) / dist(r, ring)));
  const total = (ring: number) => sizes.reduce((s, r) => s + wedge(r, ring), 0);
  let ring = 0;
  if (total(0) > 2 * Math.PI) {
    // asin(x) <= πx/2, so this ring always leaves room; bisect down to the tightest that does.
    let [lo, hi] = [0, sizes.reduce((s, r) => s + r + FOLDER_GAP / 2, 0)];
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (total(mid) > 2 * Math.PI) lo = mid;
      else hi = mid;
    }
    ring = hi;
  }
  const bySize = radii.map((_, i) => i).sort((a, b) => radii[b] - radii[a] || a - b);
  const seq: number[] = [];
  bySize.forEach((i, k) => (k % 2 ? seq.push(i) : seq.unshift(i)));
  if (inbound) seq.push(n); // between the two smallest, opposite the largest
  const spare = (2 * Math.PI - total(ring)) / sizes.length;
  const angle = new Array<number>(sizes.length);
  let a = 0;
  for (const i of seq) {
    const w = wedge(sizes[i], ring);
    angle[i] = a + w / 2;
    a += w + spare;
  }
  const turn = angle[bySize[0]];
  const at = radii.map((r, i): [number, number] => {
    const d = dist(r, ring);
    return [d * Math.cos(angle[i] - turn), d * Math.sin(angle[i] - turn)];
  });
  return { at, free: inbound ? angle[n] - turn : null };
}

const rotate = ([x, y]: [number, number], t: number): [number, number] => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];

/**
 * Notes of one topic (visualizer.md §3), gathered by gravity and linked by folder. Each folder
 * is a star cluster on its own plane, one tier farther back per nesting level: the folder note at
 * its core, long notes sinking toward it, a sparse halo of short ones. Its sub-folders orbit that
 * core, and a line runs from the core to each of theirs, so the tree reads as links across the
 * tiers and no link crosses a sibling. No outlines: the clusters and links carry the hierarchy.
 * Deterministic: the same topic always lays out the same way.
 */
export function topicLayout(topic: TopicData, radius: number): StarPlacement {
  const { branches, folderOf } = folderTree(topic);
  const empty: StarPlacement = { ids: [], positions: new Float32Array(), branches: [], skeleton: new Float32Array(), skeletonShade: new Float32Array() };
  if (!folderOf.size) return empty;
  const byId = new Map(topic.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const b of branches.values()) {
    if (b.parent !== null) children.set(b.parent, [...(children.get(b.parent) ?? []), b.key]);
  }
  const notesIn = new Map<string, string[]>();
  for (const [id, key] of folderOf) notesIn.set(key, [...(notesIn.get(key) ?? []), id]);
  const build = (key: string): Body => {
    const b = branches.get(key)!;
    const core = key === "" ? topic.hub : b.note;
    const notes = (notesIn.get(key) ?? [])
      .map((id) => ({ id, r: Math.sqrt(noteWeight(byId.get(id)?.lines ?? 0)) }))
      .sort((p, q) => Number(q.id === core) - Number(p.id === core) || q.r - p.r || p.id.localeCompare(q.id));
    const index = new Map(notes.map((x, k) => [x.id, k]));
    const pairs: [number, number][] = [];
    for (const l of topic.links) {
      const i = index.get(l.source);
      const j = index.get(l.target);
      if (i !== undefined && j !== undefined && i !== j) pairs.push([i, j]);
    }
    const cluster = notes.length ? gather(notes, pairs) : null;
    const coreR = cluster?.radius ?? JUNCTION;
    const subs = (children.get(key) ?? []).map(build);
    const { at: where, free } = orbit(coreR, subs.map((s) => s.r), key !== "");
    const e = packEnclose([{ x: 0, y: 0, r: coreR }, ...subs.map((s, i) => ({ x: where[i][0], y: where[i][1], r: s.r }))]);
    return { key, depth: b.depth, r: e.r, core: [-e.x, -e.y], cluster, subs: subs.map((body, i) => ({ body, x: where[i][0], y: where[i][1] })), free };
  };
  const root = build("");

  const scale = (radius * 0.85) / root.r;
  const TIER = radius * 0.04; // how much farther back each nesting level sits
  const at = (x: number, y: number, depth: number): [number, number, number] => {
    const back = depth * TIER;
    return [x * scale - VIEW[0] * back, y * scale * SCREEN_UP[1] - VIEW[1] * back, y * scale * SCREEN_UP[2] - VIEW[2] * back];
  };
  const pos = new Map<string, [number, number, number]>();
  const reach = new Map<string, { x: number; y: number; r: number; depth: number; label: [number, number, number] }>();
  const cores = new Map<string, [number, number, number]>();
  // Top down: each folder turns about its center, which its parent has fixed, until its clear
  // wedge faces the parent's core.
  const place = (body: Body, x: number, y: number, from: [number, number] | null) => {
    let t = 0;
    for (let k = 0; from && body.free !== null && k < 4; k++) {
      const [ox, oy] = rotate(body.core, t);
      t = Math.atan2(from[1] - y - oy, from[0] - x - ox) - body.free;
    }
    const [ox, oy] = rotate(body.core, t);
    const [cx, cy] = [x + ox, y + oy];
    cores.set(body.key, at(cx, cy, body.depth));
    const c = body.cluster;
    let top = JUNCTION;
    c?.ids.forEach((id, k) => {
      const [px, py] = rotate([c.xy[k * 2], c.xy[k * 2 + 1]], t);
      pos.set(id, at(cx + px, cy + py, body.depth));
      top = Math.max(top, py + c.r[k]);
    });
    // Its label sits just above its own topmost note, not above everything it holds.
    reach.set(body.key, { x, y, r: body.r, depth: body.depth, label: at(cx, cy + top, body.depth) });
    for (const s of body.subs) {
      const [sx, sy] = rotate([s.x, s.y], t);
      place(s.body, cx + sx, cy + sy, [cx, cy]);
    }
  };
  place(root, 0, 0, null);

  const ids = [...folderOf.keys()].filter((id) => pos.has(id)).sort((a, b) => Number(b === topic.hub) - Number(a === topic.hub));
  const positions = new Float32Array(ids.length * 3);
  ids.forEach((id, i) => positions.set(pos.get(id)!, i * 3));
  const segments: number[] = [];
  const shade: number[] = [];
  const placedBranches = [...branches.values()]
    .filter((b) => b.key !== "" && reach.has(b.key))
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key))
    .map((b) => {
      const c = reach.get(b.key)!;
      return { ...b, position: c.label, center: at(c.x, c.y, c.depth), radius: c.r * scale };
    });
  for (const b of placedBranches) {
    segments.push(...cores.get(b.parent!)!, ...cores.get(b.key)!);
    shade.push(...LINK_SHADE);
  }
  return { ids, positions, branches: placedBranches, skeleton: new Float32Array(segments), skeletonShade: new Float32Array(shade) };
}
