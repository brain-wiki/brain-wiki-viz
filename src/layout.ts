// Deterministic, local layouts (design doc 12 §3): the same brain always draws the same map,
// and no layout spans the whole brain.
import { hierarchy, pack } from "d3-hierarchy";
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
  /** The folders' circles, as segment pairs. */
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
  /** Where its label goes: the top of its circle. */
  position: [number, number, number];
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
 * How much room a note gets on the map: its area grows with its length, gently (radius with the
 * fourth root of its lines), so long notes stand out without crowding out the short ones.
 */
export function noteWeight(lines: number): number {
  return Math.sqrt(Math.max(10, lines));
}

interface PackItem {
  id: string;
  key?: string; // a folder's key; notes and note clusters have none
  plane: number; // the nesting level whose plane it sits on
  weight: number;
  first: boolean; // the topic index or a folder note (or the cluster holding it): placed first
  children?: PackItem[];
}

const OUTLINE = 48; // segments per folder circle

/**
 * Notes of one topic, packed as nested circles (design doc 12 §3): each folder is a circle that
 * holds its notes and its sub-folders' circles, so containment shows the hierarchy and the tree
 * needs no lines. A note's room grows with its length, so dense notes stand out. The circles face
 * the camera, and each nesting level sits one tier farther back along the view. The topic index
 * and each folder note sit at the heart of their circle. Deterministic: the same topic always
 * packs the same way.
 */
export function topicLayout(topic: TopicData, radius: number): StarPlacement {
  const { branches, folderOf } = folderTree(topic);
  const byId = new Map(topic.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const b of branches.values()) {
    if (b.parent !== null) children.set(b.parent, [...(children.get(b.parent) ?? []), b.key]);
  }
  const notesIn = new Map<string, string[]>();
  for (const [id, key] of folderOf) notesIn.set(key, [...(notesIn.get(key) ?? []), id]);
  const build = (key: string): PackItem => {
    const b = branches.get(key)!;
    const notes: PackItem[] = (notesIn.get(key) ?? []).map((id) => ({
      id,
      plane: b.depth,
      weight: noteWeight(byId.get(id)?.lines ?? 0),
      first: id === b.note,
    }));
    const subs = (children.get(key) ?? []).map(build);
    // A folder's own notes pack as one cluster beside its sub-folders; loose among them, small
    // notes would string out along the edge of the folder's circle.
    const own: PackItem[] =
      subs.length && notes.length > 1
        ? [{ id: `notes:${key}`, plane: b.depth, weight: 0, first: notes.some((n) => n.first), children: notes }]
        : notes;
    return { id: `branch:${key}`, key, plane: b.depth, weight: 0, first: false, children: [...own, ...subs] };
  };
  const empty: StarPlacement = { ids: [], positions: new Float32Array(), branches: [], skeleton: new Float32Array(), skeletonShade: new Float32Array() };
  if (!folderOf.size) return empty;

  const size = 2 * radius * 0.85;
  const root = hierarchy(build(""), (d) => d.children)
    .sum((d) => (d.children ? 0 : d.weight))
    .sort((a, b) => Number(b.data.first) - Number(a.data.first) || (b.value ?? 0) - (a.value ?? 0) || a.data.id.localeCompare(b.data.id));
  const packed = pack<PackItem>().size([size, size]).padding(size * 0.008)(root);

  const TIER = radius * 0.04; // how much farther back each nesting level sits
  const at = (x: number, y: number, depth: number): [number, number, number] => {
    const across = x - size / 2;
    const up = size / 2 - y;
    const back = depth * TIER;
    return [across - VIEW[0] * back, up * SCREEN_UP[1] - VIEW[1] * back, up * SCREEN_UP[2] - VIEW[2] * back];
  };
  const pos = new Map<string, [number, number, number]>();
  const circles: { key: string; x: number; y: number; r: number; depth: number }[] = [];
  for (const node of packed.descendants()) {
    if (node.data.key !== undefined) {
      if (node.data.key !== "") circles.push({ key: node.data.key, x: node.x, y: node.y, r: node.r, depth: node.data.plane });
    } else if (!node.children) {
      pos.set(node.data.id, at(node.x, node.y, node.data.plane)); // a note sits on its folder's plane
    }
  }

  const ids = [...folderOf.keys()].filter((id) => pos.has(id)).sort((a, b) => Number(b === topic.hub) - Number(a === topic.hub));
  const positions = new Float32Array(ids.length * 3);
  ids.forEach((id, i) => positions.set(pos.get(id)!, i * 3));
  // Each folder's circle, faint, on its own plane: the hierarchy without a line per note.
  const segments: number[] = [];
  const shade: number[] = [];
  for (const c of circles) {
    for (let k = 0; k < OUTLINE; k++) {
      const a0 = (k / OUTLINE) * Math.PI * 2;
      const a1 = ((k + 1) / OUTLINE) * Math.PI * 2;
      segments.push(...at(c.x + c.r * Math.cos(a0), c.y + c.r * Math.sin(a0), c.depth));
      segments.push(...at(c.x + c.r * Math.cos(a1), c.y + c.r * Math.sin(a1), c.depth));
      shade.push(0.6, 0.6);
    }
  }
  const circleOf = new Map(circles.map((c) => [c.key, c]));
  const placedBranches = [...branches.values()]
    .filter((b) => b.key !== "" && circleOf.has(b.key))
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key))
    .map((b) => {
      const c = circleOf.get(b.key)!;
      return { ...b, position: at(c.x, c.y - c.r, c.depth), center: at(c.x, c.y, c.depth), radius: c.r };
    });
  return { ids, positions, branches: placedBranches, skeleton: new Float32Array(segments), skeletonShade: new Float32Array(shade) };
}
