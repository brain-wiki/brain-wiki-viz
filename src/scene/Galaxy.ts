import CameraControls from "camera-controls";
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Source } from "../api";
import { TILT, VIEW, galaxyLayout, noteWeight, topicLayout, type BranchPlacement, type GalaxyLayout, type Placed } from "../layout";
import { chooseRevealed, healthSeverity, levelOf, projectedRadius, type Focus, type ViewSample } from "../lod";
import { FLAGS, type NodeData, type Rel, type RunSummary, type TopicData, type TopicSummary, type World } from "../types";
import { isMac } from "../util/keys";
import { gaussian, rng } from "../util/rand";
import { LabelLayer, type LabelCandidate } from "./labels";
import { glowMaterial, starMaterial, VignetteShader } from "./shaders";
import { zoomAt } from "./zoom";

CameraControls.install({
  THREE: {
    Vector2: THREE.Vector2,
    Vector3: THREE.Vector3,
    Vector4: THREE.Vector4,
    Quaternion: THREE.Quaternion,
    Matrix4: THREE.Matrix4,
    Spherical: THREE.Spherical,
    Box3: THREE.Box3,
    Sphere: THREE.Sphere,
    Raycaster: THREE.Raycaster,
  },
});

/** One end of a hovered relation. */
export interface LinkEnd {
  id: string;
  title: string;
  topic: string;
}

export type Target =
  | { kind: "constellation"; id: string }
  | { kind: "topic"; slug: string }
  | { kind: "note"; id: string; topic: string }
  | { kind: "inbox" }
  /** A typed relation; pulses run from `from` to `to` (prerequisite → dependent, old → new). */
  | { kind: "link"; family: Family; from: LinkEnd; to: LinkEnd }
  /** Typed links between two topics (or constellations), drawn as one curve. */
  | { kind: "flow"; level: "topic" | "constellation"; a: string; b: string; total: number; rels: Record<string, number> };

interface FlowHit {
  level: "topic" | "constellation";
  a: string;
  b: string;
  total: number;
  rels: Record<string, number>;
  points: THREE.Vector3[];
}

interface Picked {
  target: Target;
  key: string;
  /** Segment pairs (xyz, xyz, ...) to highlight, for links and flows. */
  segments?: number[];
  color?: string;
}

export type Family = "part_of" | "depends_on" | "conflicts_with" | "supersedes" | "related_to" | "links_to";
export type Layers = Record<Family, boolean>;
export const FAMILIES: Family[] = ["part_of", "depends_on", "conflicts_with", "supersedes", "related_to", "links_to"];
export const FAMILY_COLORS: Record<Family, string> = {
  part_of: "#5d6b8a",
  depends_on: "#4f8dff",
  conflicts_with: "#ff3b4f",
  supersedes: "#ffb347",
  related_to: "#9a7bff",
  links_to: "#7f8aa3",
};
const FAMILY_STYLE: Record<Family, { width: number; opacity: number; dashed: boolean }> = {
  part_of: { width: 1.0, opacity: 0.32, dashed: false },
  depends_on: { width: 1.7, opacity: 0.75, dashed: true },
  conflicts_with: { width: 2.4, opacity: 0.95, dashed: false },
  supersedes: { width: 2.0, opacity: 0.85, dashed: true },
  related_to: { width: 1.2, opacity: 0.38, dashed: false },
  links_to: { width: 1.0, opacity: 0.22, dashed: false },
};

export type Quality = "high" | "low";
/** What the user chose: a fixed quality, or let the map measure the GPU. */
export type QualityMode = "auto" | Quality;

const VIEW_DIR = new THREE.Vector3(...VIEW);
const MAC = isMac();

export interface GalaxyEvents {
  hover(t: Target | null, x: number, y: number): void;
  select(t: Target | null): void;
  /** Each level-of-detail tick: what the camera is looking at, and whether the user moved it. */
  view(sample: ViewSample, userDriven: boolean): void;
  quality(q: Quality, auto: boolean): void;
}

interface TopicLayer {
  slug: string;
  data: TopicData;
  center: THREE.Vector3;
  radius: number;
  group: THREE.Group;
  stars: THREE.Points;
  material: THREE.ShaderMaterial;
  state: THREE.BufferAttribute;
  sizes: Float32Array;
  ids: string[];
  index: Map<string, number>;
  nodes: NodeData[];
  world: Float32Array;
  lines: Map<Family, LineSegments2[]>;
  branches: BranchPlacement[]; // the topic's folder tree
  branchNotes: Set<string>; // folder notes: labeled as their branch
  fade: number;
  target: number;
}

/** Normalise a relation to a family and an arrow from "earlier" to "later" end. */
function familyOf(rel: Rel, source: string, target: string): [Family, string, string] | null {
  switch (rel) {
    case "part_of":
      return ["part_of", source, target];
    case "has_part":
      return ["part_of", target, source];
    case "depends_on":
      return ["depends_on", target, source]; // prerequisite → dependent
    case "enables":
      return ["depends_on", source, target];
    case "supersedes":
      return ["supersedes", target, source]; // old → new
    case "superseded_by":
      return ["supersedes", source, target];
    case "conflicts_with":
      return ["conflicts_with", source, target];
    case "related_to":
      return ["related_to", source, target];
    case "links_to":
      return ["links_to", source, target];
    default:
      return null;
  }
}

function recency(updated: string | null | undefined, now: number): number {
  if (!updated) return 0.55;
  const t = Date.parse(updated);
  if (Number.isNaN(t)) return 0.55;
  const days = Math.max(0, (now - t) / 86400000);
  return 0.45 + 0.55 * Math.exp(-days / 75);
}

/** "A · B · C · …" titles shortened to their first topic (the hub topic, else the largest), for labels on the map. */
export function shortTitle(title: string): string {
  return title.split(" · ")[0];
}

/**
 * Per-group state sampled by the glow shader, eased toward its target every frame.
 * Channels: r = alpha, g = brightness boost, b = health tint amount, a = health severity.
 */
class GroupTexture {
  readonly value: Float32Array;
  readonly target: Float32Array;
  readonly texture: THREE.DataTexture;

  constructor(readonly count: number) {
    const n = Math.max(1, count);
    this.value = new Float32Array(n * 4);
    this.target = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.value[i * 4] = this.target[i * 4] = 1;
    this.texture = new THREE.DataTexture(this.value, n, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  set(i: number, alpha: number, boost: number, tint: number, severity: number): void {
    this.target.set([alpha, boost, tint, severity], i * 4);
  }

  ease(k: number): void {
    let changed = false;
    for (let i = 0; i < this.value.length; i++) {
      const d = this.target[i] - this.value[i];
      if (Math.abs(d) > 1e-3) {
        this.value[i] += d * k;
        changed = true;
      }
    }
    if (changed) this.texture.needsUpdate = true;
  }
}

const col = new THREE.Color();
function rgb(hex: string, mul = 1): [number, number, number] {
  col.set(hex);
  return [col.r * mul, col.g * mul, col.b * mul];
}

export class Galaxy {
  readonly layout: GalaxyLayout;
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private controls: CameraControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private bloomTarget = 0.95;
  private vignette: ShaderPass;
  private labels: LabelLayer;
  private clock = new THREE.Clock();
  private topics: TopicSummary[];
  private topicIndex = new Map<string, number>();
  private topicBySlug = new Map<string, TopicSummary>();
  private groups: GroupTexture;
  private dustGroups: GroupTexture;
  private glowMats: THREE.ShaderMaterial[] = [];
  private starMats = new Set<THREE.ShaderMaterial>();
  private lineMats = new Map<string, LineMaterial>();
  private flowGroup = new THREE.Group();
  private focusLines = new THREE.Group();
  private revealed = new Map<string, TopicLayer>();
  private pending = new Map<string, Promise<void>>();
  private topicPx = new Map<string, number>();
  private focus: Focus = {};
  private neighborhood = new Map<string, number>();
  private run: RunSummary | null = null;
  private layers: Layers = { part_of: true, depends_on: true, conflicts_with: true, supersedes: true, related_to: true, links_to: false };
  private health = false;
  private severity: Float32Array;
  private dustSeverity: Float32Array;
  private motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private quality: Quality = "high";
  private qualityMode: QualityMode = "auto";
  private autoDecided = false;
  private autoFrom = 1.5;
  private autoSamples: number[] = [];
  private frameTimes: number[] = [];
  private lastLod = 0;
  private pointer = { x: 0, y: 0, down: false, dx: 0, dy: 0, moved: false, dirty: false, inside: false };
  private hovered: string | null = null;
  private flowHits: FlowHit[] = [];
  private focusHits: { family: Family; from: LinkEnd; to: LinkEnd; a: number[]; b: number[] }[] = [];
  private hoverLine: LineSegments2 | null = null;
  /** Notes at both ends of the hovered link, and topics or constellations at both ends of a hovered flow. */
  private hoverEnds = new Set<string>();
  private hoverTopics = new Set<string>();
  private now = Date.now();
  private disposed = false;
  /** True while the camera moves because of the user (drag, wheel), not a scripted flight. */
  userDriven = false;
  fps = 0;

  constructor(
    private container: HTMLElement,
    private world: World,
    private source: Source,
    private events: GalaxyEvents,
    quality: QualityMode,
  ) {
    this.qualityMode = quality;
    if (quality !== "auto") this.quality = quality;
    this.topics = world.topics;
    world.topics.forEach((t, i) => {
      this.topicIndex.set(t.slug, i);
      this.topicBySlug.set(t.slug, t);
    });
    this.layout = galaxyLayout(world.constellations, world.topics, world.episodes.count);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x03050b, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "scene-canvas";
    container.appendChild(this.renderer.domElement);

    const R = this.layout.radius;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, R * 30);
    this.controls = new CameraControls(this.camera, this.renderer.domElement);
    this.controls.smoothTime = this.motion ? 0.55 : 0;
    this.controls.draggingSmoothTime = 0.12;
    this.controls.minDistance = 4;
    this.controls.maxDistance = R * 7;
    this.controls.dollySpeed = 0.6;
    // Map navigation: dragging slides over the galactic plane, the wheel or a pinch zooms; no orbiting.
    this.controls.minPolarAngle = this.controls.maxPolarAngle = TILT;
    this.controls.minAzimuthAngle = this.controls.maxAzimuthAngle = 0;
    // SCREEN_PAN moves along the ground (sideways and forward); TRUCK would slide up the tilted view plane.
    this.controls.mouseButtons.left = CameraControls.ACTION.SCREEN_PAN;
    this.controls.mouseButtons.right = CameraControls.ACTION.SCREEN_PAN;
    this.controls.mouseButtons.middle = CameraControls.ACTION.DOLLY;
    this.controls.mouseButtons.wheel = CameraControls.ACTION.NONE; // see wheel(): toward the cursor, on the map
    this.controls.touches.one = CameraControls.ACTION.TOUCH_SCREEN_PAN;
    this.controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY;
    this.controls.touches.three = CameraControls.ACTION.NONE;
    // Any direct input means the user now owns the camera: scrolling and dragging may change the
    // level (camera-controls signals drags with controlstart, but not wheel zooms).
    this.controls.addEventListener("controlstart", () => {
      this.userDriven = true;
    });
    this.renderer.domElement.addEventListener("wheel", this.wheel, { passive: false });

    this.groups = new GroupTexture(this.topics.length);
    this.dustGroups = new GroupTexture(world.constellations.length);
    this.severity = healthSeverity(this.topics);
    this.dustSeverity = healthSeverity(
      world.constellations.map((c) => {
        const ts = c.topics.map((s) => this.topicBySlug.get(s)).filter((t): t is TopicSummary => !!t);
        return { notes: ts.reduce((s, t) => s + t.notes, 0), flagged: ts.reduce((s, t) => s + t.flagged, 0) };
      }),
    );

    this.buildStarfield();
    this.buildDust();
    this.buildNebulae();
    this.buildInbox();
    this.scene.add(this.flowGroup);
    this.scene.add(this.focusLines);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.95, 0.6, 0.08);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());

    this.labels = new LabelLayer(container);
    this.bindPointer();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.flyTo({}, true);
    this.buildFlows();
    this.renderer.setAnimationLoop(this.frame);
  }

  // --- building -------------------------------------------------------------------------

  private points(count: number, fill: (i: number, a: Record<string, Float32Array>) => void, material: THREE.ShaderMaterial, extra: Record<string, number> = {}): THREE.Points {
    const attrs: Record<string, Float32Array> = {
      position: new Float32Array(count * 3),
      aColor: new Float32Array(count * 3),
      aSize: new Float32Array(count),
      aAlpha: new Float32Array(count),
      aGroup: new Float32Array(count),
    };
    for (const [name, size] of Object.entries(extra)) attrs[name] = new Float32Array(count * size);
    for (let i = 0; i < count; i++) fill(i, attrs);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(attrs.position, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(attrs.aColor, 3));
    for (const name of ["aSize", "aAlpha", "aGroup"]) geo.setAttribute(name, new THREE.BufferAttribute(attrs[name], 1));
    for (const [name, size] of Object.entries(extra)) geo.setAttribute(name, new THREE.BufferAttribute(attrs[name], size));
    geo.computeBoundingSphere();
    const p = new THREE.Points(geo, material);
    p.frustumCulled = false;
    return p;
  }

  private plainGlow(falloff = 4): THREE.ShaderMaterial {
    const tex = new THREE.DataTexture(new Float32Array([1, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const m = glowMaterial(tex, 1);
    m.uniforms.uFalloff.value = falloff;
    this.glowMats.push(m);
    return m;
  }

  private buildStarfield(): void {
    const R = this.layout.radius;
    const r = rng("starfield");
    const count = 6500;
    const pts = this.points(count, (i, a) => {
      const u = r() * 2 - 1;
      const phi = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const d = R * (3.2 + r() * 4);
      a.position.set([d * s * Math.cos(phi), d * u, d * s * Math.sin(phi)], i * 3);
      const warm = r();
      a.aColor.set(warm < 0.15 ? [1, 0.85, 0.7] : warm < 0.4 ? [0.75, 0.85, 1] : [0.9, 0.93, 1], i * 3);
      a.aSize[i] = R * (0.006 + 0.012 * r() ** 3);
      a.aAlpha[i] = 0.25 + 0.6 * r();
    }, this.plainGlow(6));
    this.scene.add(pts);
  }

  private buildDust(): void {
    const per = 70;
    const cs = this.world.constellations;
    const mat = glowMaterial(this.dustGroups.texture, Math.max(1, cs.length));
    mat.uniforms.uFalloff.value = 2.5;
    this.glowMats.push(mat);
    const pts = this.points(cs.length * per, (i, a) => {
      const ci = Math.floor(i / per);
      const c = cs[ci];
      const p = this.layout.constellations.get(c.id)!;
      const r = rng(`dust:${c.id}:${i % per}`);
      a.position.set([p.x + gaussian(r) * p.r * 0.55, p.y + gaussian(r) * p.r * 0.12, p.z + gaussian(r) * p.r * 0.55], i * 3);
      a.aColor.set(rgb(c.color, 0.9), i * 3);
      a.aSize[i] = p.r * (0.5 + 0.6 * r());
      a.aAlpha[i] = 0.018 + 0.03 * r();
      a.aGroup[i] = ci;
    }, mat);
    this.scene.add(pts);
  }

  private buildNebulae(): void {
    const parts: { slug: string; i: number; kind: "core" | "cloud" | "conflict" }[] = [];
    this.topics.forEach((t) => {
      const cloud = Math.max(10, Math.min(80, Math.round(10 + t.notes * 0.55)));
      parts.push({ slug: t.slug, i: 0, kind: "core" });
      for (let k = 0; k < cloud; k++) parts.push({ slug: t.slug, i: k, kind: "cloud" });
      const conflicts = Math.min(6, t.flags.conflict ?? 0);
      for (let k = 0; k < conflicts; k++) parts.push({ slug: t.slug, i: k, kind: "conflict" });
    });
    const mat = glowMaterial(this.groups.texture, Math.max(1, this.topics.length));
    this.glowMats.push(mat);
    const pts = this.points(parts.length, (j, a) => {
      const part = parts[j];
      const t = this.topicBySlug.get(part.slug)!;
      const p = this.layout.topics.get(part.slug)!;
      const g = this.topicIndex.get(part.slug)!;
      const fresh = recency(t.updated, this.now) * (1 + Math.min(0.4, t.recent / Math.max(1, t.notes)));
      a.aGroup[j] = g;
      if (part.kind === "core") {
        a.position.set([p.x, p.y, p.z], j * 3);
        a.aColor.set(rgb(t.color, 1.25), j * 3);
        a.aSize[j] = p.r * 0.95;
        a.aAlpha[j] = 0.75 * fresh;
        return;
      }
      const r = rng(`neb:${part.slug}:${part.kind}:${part.i}`);
      const spread = part.kind === "conflict" ? 0.3 : 0.42;
      a.position.set([p.x + gaussian(r) * p.r * spread, p.y + gaussian(r) * p.r * spread * 0.5, p.z + gaussian(r) * p.r * spread], j * 3);
      if (part.kind === "conflict") {
        a.aColor.set([1, 0.2, 0.26], j * 3);
        a.aSize[j] = p.r * 0.38;
        a.aAlpha[j] = 0.35;
      } else {
        const [cr, cg, cb] = rgb(t.color);
        const v = 0.75 + 0.5 * r();
        a.aColor.set([cr * v, cg * v, cb * v], j * 3);
        a.aSize[j] = p.r * (0.3 + 0.45 * r());
        a.aAlpha[j] = (0.08 + 0.1 * r()) * fresh;
      }
    }, mat);
    this.scene.add(pts);
  }

  private buildInbox(): void {
    const inbox = this.layout.inbox;
    const count = Math.min(420, this.world.episodes.count) + 1;
    const r = rng("inbox");
    const pts = this.points(count, (i, a) => {
      if (i === 0) {
        a.position.set([inbox.x, inbox.y, inbox.z], 0);
        a.aColor.set([1.2, 1.05, 0.8], 0);
        a.aSize[0] = inbox.r * 1.6;
        a.aAlpha[0] = this.world.episodes.count ? 0.85 : 0.25;
        return;
      }
      a.position.set([inbox.x + gaussian(r) * inbox.r * 0.45, inbox.y + gaussian(r) * inbox.r * 0.3, inbox.z + gaussian(r) * inbox.r * 0.45], i * 3);
      a.aColor.set(r() < 0.5 ? [1, 0.86, 0.55] : [1, 0.95, 0.85], i * 3);
      a.aSize[i] = 2 + 3 * r();
      a.aAlpha[i] = 0.5 + 0.5 * r();
    }, this.plainGlow(5));
    this.scene.add(pts);
  }

  private lineMaterial(key: string, width: number, opacity: number, dashed: boolean): LineMaterial {
    let m = this.lineMats.get(key);
    if (!m) {
      // Dashed materials draw short pulses over a solid trail (see trail()), not a broken line.
      m = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, transparent: true, opacity, dashed, dashSize: 2.5, gapSize: 16, dashScale: 1, worldUnits: false });
      m.depthWrite = false;
      m.blending = THREE.AdditiveBlending;
      m.resolution.set(this.container.clientWidth, this.container.clientHeight);
      this.lineMats.set(key, m);
    }
    return m;
  }

  /** A typed trail: always a solid line; directed families add pulses running along it when motion is on. */
  private trail(pos: number[], colors: number[], key: string, width: number, opacity: number, directed: boolean): LineSegments2[] {
    const pulsed = directed && this.motion;
    const base = this.segments(pos, colors, this.lineMaterial(key, width, pulsed ? opacity * 0.55 : opacity, false));
    if (!pulsed) return [base];
    return [base, this.segments(pos, colors, this.lineMaterial(`${key}:pulse`, width + 0.8, Math.min(1, opacity + 0.2), true))];
  }

  private segments(pos: number[], colors: number[], material: LineMaterial): LineSegments2 {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    geo.setColors(colors);
    const line = new LineSegments2(geo, material);
    if (material.dashed) line.computeLineDistances();
    line.frustumCulled = false;
    return line;
  }

  /** Aggregated flows between constellations (galaxy) or topics (constellation and below). */
  private buildFlows(): void {
    for (const child of [...this.flowGroup.children]) {
      this.flowGroup.remove(child);
      (child as LineSegments2).geometry.dispose();
    }
    const level = levelOf(this.focus);
    const ends: { a: THREE.Vector3; b: THREE.Vector3; ca: string; cb: string; w: number; lit: boolean; ka: string; kb: string; rels: Record<string, number> }[] = [];
    this.flowHits = [];
    const cOf = (slug: string) => this.topicBySlug.get(slug)?.constellation;
    // While a run is selected, flows that do not touch what it changed fade back.
    const runTopics = this.run ? new Set(Object.keys(this.run.topics)) : null;
    const runCons = runTopics ? new Set([...runTopics].map(cOf)) : null;
    const tPos = (slug: string) => {
      const p = this.layout.topics.get(slug)!;
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    const cPos = (id: string) => {
      const p = this.layout.constellations.get(id)!;
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    const cColor = new Map(this.world.constellations.map((c) => [c.id, c.color]));
    if (level === "galaxy" && this.world.constellations.length > 1) {
      const agg = new Map<string, number>();
      const aggRels = new Map<string, Record<string, number>>();
      for (const f of this.world.flows) {
        const a = cOf(f.a);
        const b = cOf(f.b);
        if (!a || !b || a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        agg.set(key, (agg.get(key) ?? 0) + f.total);
        const rels = aggRels.get(key) ?? {};
        for (const [rel, n] of Object.entries(f.rels)) rels[rel] = (rels[rel] ?? 0) + n;
        aggRels.set(key, rels);
      }
      [...agg.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 70)
        .forEach(([key, w]) => {
          const [a, b] = key.split("|");
          ends.push({ a: cPos(a), b: cPos(b), ca: cColor.get(a)!, cb: cColor.get(b)!, w, lit: !runCons || runCons.has(a) || runCons.has(b), ka: a, kb: b, rels: aggRels.get(key) ?? {} });
        });
    } else {
      const inC = (slug: string) => !this.focus.constellation || cOf(slug) === this.focus.constellation;
      const focusTopic = this.focus.topic;
      const flows = this.world.flows.filter((f) =>
        focusTopic ? f.a === focusTopic || f.b === focusTopic : inC(f.a) && inC(f.b),
      );
      flows
        .sort((x, y) => y.total - x.total)
        .slice(0, focusTopic ? 24 : 160)
        .forEach((f) => {
          ends.push({ a: tPos(f.a), b: tPos(f.b), ca: this.topicBySlug.get(f.a)!.color, cb: this.topicBySlug.get(f.b)!.color, w: f.total, lit: !runTopics || runTopics.has(f.a) || runTopics.has(f.b), ka: f.a, kb: f.b, rels: f.rels });
        });
    }
    if (ends.length === 0) return;
    const sorted = ends.map((e) => e.w).sort((x, y) => x - y);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const buckets = [
      { max: q(0.6), width: 1.0, opacity: 0.14 },
      { max: q(0.9), width: 1.8, opacity: 0.22 },
      { max: Infinity, width: 2.8, opacity: 0.32 },
    ];
    buckets.forEach((bucket, bi) => {
      const pos: number[] = [];
      const colors: number[] = [];
      const min = bi === 0 ? -Infinity : buckets[bi - 1].max;
      for (const e of ends) {
        if (!(e.w > min && e.w <= bucket.max)) continue;
        const mid = e.a.clone().add(e.b).multiplyScalar(0.5);
        mid.y += e.a.distanceTo(e.b) * 0.22;
        const curve = new THREE.QuadraticBezierCurve3(e.a, mid, e.b);
        const pts = curve.getPoints(14);
        this.flowHits.push({ level: level === "galaxy" && this.world.constellations.length > 1 ? "constellation" : "topic", a: e.ka, b: e.kb, total: e.w, rels: e.rels, points: pts });
        const [ar, ag, ab] = rgb(e.ca);
        const [br, bg, bb] = rgb(e.cb);
        const lit = e.lit ? 1 : 0.15;
        for (let k = 0; k < pts.length - 1; k++) {
          const t0 = k / (pts.length - 1);
          const t1 = (k + 1) / (pts.length - 1);
          pos.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
          // Brightest at the ends, faint in the middle: reads as a link, not a wall.
          const f0 = (0.35 + 0.65 * Math.abs(t0 - 0.5) * 2) * lit;
          const f1 = (0.35 + 0.65 * Math.abs(t1 - 0.5) * 2) * lit;
          colors.push(
            (ar + (br - ar) * t0) * f0, (ag + (bg - ag) * t0) * f0, (ab + (bb - ab) * t0) * f0,
            (ar + (br - ar) * t1) * f1, (ag + (bg - ag) * t1) * f1, (ab + (bb - ab) * t1) * f1,
          );
        }
      }
      if (pos.length) this.flowGroup.add(this.segments(pos, colors, this.lineMaterial(`flow${bi}`, bucket.width, bucket.opacity, false)));
    });
    this.dimFlows();
  }

  // --- topic layers ---------------------------------------------------------------------

  /** Load and show a topic's stars; concurrent callers share the one in-flight load. */
  private reveal(slug: string): Promise<void> {
    if (this.revealed.has(slug)) return Promise.resolve();
    let loading = this.pending.get(slug);
    if (!loading) {
      loading = this.load(slug).finally(() => this.pending.delete(slug));
      this.pending.set(slug, loading);
    }
    return loading;
  }

  private async load(slug: string): Promise<void> {
    const data = await this.source.topic(slug);
    if (!data || this.disposed) return;
    const p = this.layout.topics.get(slug);
    if (!p) return;
    this.revealed.set(slug, this.buildLayer(data, p));
    if (this.focus.note) this.buildNeighborhood();
    this.refreshStates();
    this.refreshGroups();
  }

  private buildLayer(data: TopicData, p: Placed): TopicLayer {
    const placement = topicLayout(data, p.r);
    const center = new THREE.Vector3(p.x, p.y, p.z);
    const byId = new Map(data.nodes.map((nd) => [nd.id, nd]));
    const nodes = placement.ids.map((id) => byId.get(id)!);
    const index = new Map(placement.ids.map((id, i) => [id, i]));
    const count = nodes.length;
    const material = starMaterial();
    material.uniforms.uScale.value = this.pointScale();
    material.uniforms.uHealth.value = this.health ? 1 : 0;
    material.uniforms.uMotion.value = this.motion ? 1 : 0;
    material.uniforms.uFade.value = 0;
    this.starMats.add(material);
    const geo = new THREE.BufferGeometry();
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const flags = new Float32Array(count);
    const states = new Float32Array(count);
    const world = new Float32Array(count * 3);
    const [tr, tg, tb] = rgb(data.color);
    nodes.forEach((nd, i) => {
      const hub = nd.id === data.hub;
      const ghost = nd.status === "superseded" || nd.status === "archived";
      const mix = hub ? 0.25 : 0.55;
      colors.set([tr * (1 - mix) + mix, tg * (1 - mix) + mix, tb * (1 - mix) + mix], i * 3);
      if (ghost) colors.set([0.55, 0.58, 0.66], i * 3);
      // Size shows how much a note holds (the fourth root of its lines, as its room in the layout).
      sizes[i] = hub ? 8 : Math.min(7.2, Math.max(2.2, 1.2 + 0.8 * Math.sqrt(noteWeight(nd.lines ?? 0))));
      alphas[i] = (ghost ? 0.32 : 1) * recency(nd.updated, this.now);
      const first = FLAGS.findIndex((f) => nd.flags.includes(f));
      flags[i] = first < 0 ? 0 : first + 1;
      world[i * 3] = placement.positions[i * 3] + center.x;
      world[i * 3 + 1] = placement.positions[i * 3 + 1] + center.y;
      world[i * 3 + 2] = placement.positions[i * 3 + 2] + center.z;
    });
    geo.setAttribute("position", new THREE.BufferAttribute(placement.positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute("aFlag", new THREE.BufferAttribute(flags, 1));
    const state = new THREE.BufferAttribute(states, 1);
    state.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aState", state);
    const stars = new THREE.Points(geo, material);
    stars.frustumCulled = false;
    const group = new THREE.Group();
    group.position.copy(center);
    group.add(stars);

    // Trails inside the topic, one object per family so layers toggle independently.
    const local = (id: string) => {
      const i = index.get(id);
      return i === undefined ? null : [placement.positions[i * 3], placement.positions[i * 3 + 1], placement.positions[i * 3 + 2]];
    };
    const perFamily = new Map<Family, { pos: number[]; colors: number[] }>();
    for (const l of data.links) {
      const fam = familyOf(l.rel, l.source, l.target);
      if (!fam) continue;
      const [family, from, to] = fam;
      if (family === "part_of") continue; // the folder tree below draws containment
      const a = local(from);
      const b = local(to);
      if (!a || !b || from === to) continue;
      let bucket = perFamily.get(family);
      if (!bucket) perFamily.set(family, (bucket = { pos: [], colors: [] }));
      bucket.pos.push(...a, ...b);
      const c = rgb(FAMILY_COLORS[family]);
      bucket.colors.push(c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, c[0], c[1], c[2]);
    }
    const lines = new Map<Family, LineSegments2[]>();
    for (const [family, b] of perFamily) {
      const st = FAMILY_STYLE[family];
      const trail = this.trail(b.pos, b.colors, `fam:${family}`, st.width, st.opacity, st.dashed);
      for (const line of trail) {
        line.visible = false;
        group.add(line);
      }
      lines.set(family, trail);
    }
    // The folder tree (design doc 12 §3): a link from each folder's core to its parent's.
    if (placement.skeleton.length) {
      const tree: number[] = [];
      for (const t of placement.skeletonShade) {
        const k = 0.3 + 0.7 * t;
        tree.push(tr * k, tg * k, tb * k);
      }
      const st = FAMILY_STYLE.part_of;
      const trail = this.trail([...placement.skeleton], tree, "fam:part_of", st.width, st.opacity, false);
      for (const line of trail) {
        line.visible = false;
        group.add(line);
      }
      lines.set("part_of", trail);
    }
    this.scene.add(group);
    const branchNotes = new Set(placement.branches.flatMap((b) => (b.note ? [b.note] : [])));
    return { slug: data.slug, data, center, radius: p.r, group, stars, material, state, sizes, ids: placement.ids, index, nodes, world, lines, branches: placement.branches, branchNotes, fade: 0, target: 1 };
  }

  private disposeLayer(layer: TopicLayer): void {
    this.scene.remove(layer.group);
    layer.stars.geometry.dispose();
    layer.material.dispose();
    this.starMats.delete(layer.material);
    for (const trail of layer.lines.values()) for (const line of trail) line.geometry.dispose();
  }

  // --- state -------------------------------------------------------------------------------

  setFocus(f: Focus, fly = true): void {
    const changedLevel = levelOf(f) !== levelOf(this.focus) || f.constellation !== this.focus.constellation || f.topic !== this.focus.topic;
    this.focus = { ...f };
    this.buildNeighborhood();
    if (f.topic) void this.reveal(f.topic);
    if (changedLevel) this.buildFlows();
    this.refreshGroups();
    this.refreshStates();
    if (fly) this.flyTo(f);
  }

  /** The selected note, its typed neighbours, and bright lines to each (also across topics). */
  private buildNeighborhood(): void {
    this.neighborhood.clear();
    this.focusHits = [];
    for (const child of [...this.focusLines.children]) {
      this.focusLines.remove(child);
      (child as LineSegments2).geometry.dispose();
    }
    const f = this.focus;
    const layer = f.note && f.topic ? this.revealed.get(f.topic) : undefined;
    const i = layer && f.note ? layer.index.get(f.note) : undefined;
    if (!layer || i === undefined || !f.note) return;
    this.neighborhood.set(f.note, 3);
    const from = [layer.world[i * 3], layer.world[i * 3 + 1], layer.world[i * 3 + 2]];
    const where = (id: string, topic: string | null): number[] | null => {
      for (const l of [layer, topic ? this.revealed.get(topic) : undefined]) {
        const k = l?.index.get(id);
        if (l && k !== undefined) return [l.world[k * 3], l.world[k * 3 + 1], l.world[k * 3 + 2]];
      }
      const p = topic ? this.layout.topics.get(topic) : undefined;
      return p ? [p.x, p.y, p.z] : null;
    };
    const per = new Map<Family, { pos: number[]; colors: number[] }>();
    const me: LinkEnd = { id: f.note, title: layer.nodes[i].title, topic: layer.slug };
    const add = (rel: Rel, source: string, target: string, other: string, topic: string | null, title: string) => {
      if (rel === "links_to") return;
      const fam = familyOf(rel, source, target);
      const to = where(other, topic);
      if (!fam || !to) return;
      if (!this.neighborhood.has(other)) this.neighborhood.set(other, 2);
      const [family, a] = fam;
      const forward = a === f.note;
      const them: LinkEnd = { id: other, title, topic: topic ?? layer.slug };
      this.focusHits.push(forward ? { family, from: me, to: them, a: from, b: to } : { family, from: them, to: me, a: to, b: from });
      let b = per.get(family);
      if (!b) per.set(family, (b = { pos: [], colors: [] }));
      b.pos.push(...(forward ? from : to), ...(forward ? to : from));
      const c = rgb(FAMILY_COLORS[family]);
      b.colors.push(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2);
    };
    const titleOf = (id: string) => layer.nodes[layer.index.get(id) ?? -1]?.title ?? id;
    for (const l of layer.data.links) {
      if (l.source === f.note) add(l.rel, l.source, l.target, l.target, layer.slug, titleOf(l.target));
      else if (l.target === f.note) add(l.rel, l.source, l.target, l.source, layer.slug, titleOf(l.source));
    }
    for (const e of layer.data.external) {
      if (e.source === f.note) add(e.rel, e.source, e.target, e.target, e.topic, e.title);
      else if (e.target === f.note) add(e.rel, e.source, e.target, e.source, e.topic, e.title);
    }
    for (const [family, b] of per) {
      const st = FAMILY_STYLE[family];
      for (const line of this.trail(b.pos, b.colors, `focus:${family}`, st.width + 1, Math.min(1, st.opacity + 0.25), st.dashed)) this.focusLines.add(line);
    }
  }

  setRun(run: RunSummary | null): void {
    this.run = run;
    this.buildFlows();
    this.refreshGroups();
    this.refreshStates();
  }

  setLayers(layers: Layers): void {
    this.layers = { ...layers };
    for (const layer of this.revealed.values()) {
      for (const [family, trail] of layer.lines) for (const line of trail) line.visible = this.layers[family] && layer.fade > 0.05;
    }
  }

  setHealth(on: boolean): void {
    this.health = on;
    for (const m of this.starMats) m.uniforms.uHealth.value = on ? 1 : 0;
    this.dimFlows();
    this.refreshGroups();
  }

  /** Flows are coloured by constellation; health mode fades them so the health colours read. */
  private dimFlows(): void {
    for (const [key, m] of this.lineMats) {
      if (!key.startsWith("flow")) continue;
      m.userData.base ??= m.opacity;
      m.opacity = (m.userData.base as number) * (this.health ? 0.3 : 1);
    }
  }

  setLabels(on: boolean): void {
    this.labels.setVisible(on);
  }

  /** A fixed quality, or "auto" to measure again from now. */
  setQualityMode(mode: QualityMode): void {
    this.qualityMode = mode;
    if (mode !== "auto") {
      this.quality = mode;
      return;
    }
    this.quality = "high";
    this.autoDecided = false;
    this.autoSamples = [];
    this.autoFrom = this.clock.elapsedTime + 1.5;
  }

  private refreshGroups(): void {
    const f = this.focus;
    const touched = this.run ? new Set(Object.keys(this.run.topics)) : null;
    this.topics.forEach((t, i) => {
      let a = 1;
      let boost = 0;
      if (f.topic) a = t.slug === f.topic ? (f.note ? 0.05 : 0.1) : 0.22;
      else if (f.constellation) a = t.constellation === f.constellation ? 1 : 0.3;
      if (this.revealed.has(t.slug) && t.slug !== f.topic) a *= 0.45;
      const s = this.severity[i];
      if (this.health) a *= 0.3 + 0.7 * s;
      if (touched) {
        // Bright cores saturate under tone mapping, so a mild dim would not read.
        if (touched.has(t.slug)) boost = 0.45;
        else a *= 0.12;
      }
      this.groups.set(i, a, boost, this.health ? 1 : 0, s);
    });
    // Close up, the dust sprites fill the screen and add up to a white wash; thin it as the camera nears.
    this.world.constellations.forEach((_, i) => {
      const s = this.dustSeverity[i];
      let a = f.note ? 0.3 : f.topic || f.constellation ? 0.4 : 1;
      if (this.health) a *= 0.35 + 0.65 * s;
      this.dustGroups.set(i, a, 0, this.health ? 1 : 0, s);
    });
    for (const layer of this.revealed.values()) {
      layer.target = !f.topic || layer.slug === f.topic || this.run?.topics[layer.slug] ? 1 : 0.3;
    }
    // Full bloom merges a close-up cluster into one white blob; keep it for the wide views.
    this.bloomTarget = f.note ? 0.45 : f.topic ? 0.5 : 0.95;
  }

  private refreshStates(): void {
    const touched = this.run ? new Set(this.run.touched) : null;
    for (const layer of this.revealed.values()) {
      const arr = layer.state.array as Float32Array;
      layer.ids.forEach((id, i) => {
        let s = 0;
        if (this.neighborhood.size) s = this.neighborhood.get(id) ?? 1;
        if (touched) s = touched.has(id) ? Math.max(s, 2) : s || 1;
        if (this.hoverEnds.has(id)) s = Math.max(s, 2);
        arr[i] = s;
      });
      layer.state.needsUpdate = true;
    }
  }

  // --- camera ---------------------------------------------------------------------------

  flyTo(f: Focus, instant = false): void {
    this.userDriven = false;
    const smooth = !instant && this.motion;
    const R = this.layout.radius;
    const go = (c: THREE.Vector3, d: number) => {
      const pos = c.clone().addScaledVector(VIEW_DIR, d);
      void this.controls.setLookAt(pos.x, pos.y, pos.z, c.x, c.y, c.z, smooth);
    };
    if (f.note && f.topic) {
      const layer = this.revealed.get(f.topic);
      const i = layer?.index.get(f.note);
      if (layer && i !== undefined) {
        const c = new THREE.Vector3(layer.world[i * 3], layer.world[i * 3 + 1], layer.world[i * 3 + 2]);
        go(c, Math.max(48, layer.radius * 1.1));
        return;
      }
      // The topic is still loading: fly to it now, then on to the note once its star exists
      // (a note missing from the topic must not send this back into the same branch).
      const topic = f.topic;
      const note = f.note;
      void this.reveal(topic).then(() => {
        if (this.focus.note === note && this.revealed.get(topic)?.index.has(note)) this.flyTo(this.focus);
      });
    }
    if (f.topic) {
      const p = this.layout.topics.get(f.topic);
      if (p) go(new THREE.Vector3(p.x, p.y, p.z), p.r * 3.1);
      return;
    }
    const c = f.constellation ? this.layout.constellations.get(f.constellation) : this.world.constellations.length === 1 ? this.layout.constellations.get(this.world.constellations[0].id) : undefined;
    if (c) {
      go(new THREE.Vector3(c.x, c.y, c.z), c.r * 2.4);
      return;
    }
    // The whole galaxy, nudged right of the navigator panel.
    const fit = R / Math.sin((this.camera.fov * Math.PI) / 360) / Math.min(1, this.camera.aspect);
    go(new THREE.Vector3(-R * 0.08, 0, 0), fit * 0.86);
  }

  resetView(): void {
    this.flyTo({});
  }

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.userDriven = true;
    // Read the wheel as camera-controls does: a line, or a trackpad pinch (ctrlKey), counts more than a pixel.
    const factor = MAC ? -1 : -3;
    const delta = e.deltaMode === 1 || e.ctrlKey ? e.deltaY / factor : e.deltaY / (factor * 10);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    // The camera never turns, so this direction holds wherever a zoom in progress ends.
    const ray = new THREE.Vector3(x, y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const next = zoomAt(
      this.controls.getPosition(new THREE.Vector3()),
      this.controls.getTarget(new THREE.Vector3()),
      ray,
      Math.pow(0.95, delta * this.controls.dollySpeed),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    void this.controls.setLookAt(next.pos.x, next.pos.y, next.pos.z, next.target.x, next.target.y, next.target.z, this.motion);
  };

  /** Camera position and look target, for the minimap. */
  view(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    return { pos: this.camera.position.clone(), target: this.controls.getTarget(new THREE.Vector3()) };
  }

  /** Distance from the camera to the current focus, relative to its size (for auto pop-up). */
  // --- per frame --------------------------------------------------------------------------

  private pointScale(): number {
    const h = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    return h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  private resize = (): void => {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const s = this.pointScale();
    for (const m of this.glowMats) m.uniforms.uScale.value = s;
    for (const m of this.starMats) m.uniforms.uScale.value = s;
    for (const m of this.lineMats.values()) m.resolution.set(w, h);
  };

  private frame = (): void => {
    if (this.disposed) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.controls.update(dt);
    this.trackFps(dt);
    const now = performance.now();
    if (now - this.lastLod > 120) {
      this.lastLod = now;
      this.updateLod();
    }
    this.animate(dt, t);
    if (this.pointer.dirty) {
      this.pointer.dirty = false;
      this.hover();
    }
    this.updateLabels();
    if (this.quality === "high") {
      this.vignette.uniforms.uTime.value = t;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private trackFps(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((s, x) => s + x, 0) / this.frameTimes.length;
    this.fps = avg > 0 ? 1 / avg : 0;
    // Auto: skip the first 1.5 s (shader compiles, topic loads), sample 2.5 s of frames, and
    // judge by the median so a few stalls cannot make a fast GPU look slow.
    if (this.qualityMode !== "auto" || this.autoDecided) return;
    const t = this.clock.elapsedTime;
    if (t < this.autoFrom) return;
    this.autoSamples.push(dt);
    if (t < this.autoFrom + 2.5 || this.autoSamples.length < 20) return;
    const sorted = [...this.autoSamples].sort((a, b) => a - b);
    const q: Quality = sorted[sorted.length >> 1] > 1 / 30 ? "low" : "high";
    this.autoDecided = true;
    this.autoSamples = [];
    this.quality = q;
    this.events.quality(q, true);
  }

  private animate(dt: number, t: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.groups.ease(k);
    this.dustGroups.ease(k);
    this.bloom.strength += (this.bloomTarget - this.bloom.strength) * k;
    for (const [slug, layer] of [...this.revealed]) {
      layer.fade += (layer.target - layer.fade) * k;
      layer.material.uniforms.uFade.value = layer.fade;
      layer.material.uniforms.uTime.value = t;
      layer.group.visible = layer.fade > 0.02;
      // Per object: the materials are shared, so one fading topic must not hide every topic's trails.
      for (const [family, trail] of layer.lines) for (const line of trail) line.visible = this.layers[family] && layer.fade > 0.05;
      if (layer.target === 0 && layer.fade < 0.03) {
        this.disposeLayer(layer);
        this.revealed.delete(slug);
      }
    }
    if (this.motion) {
      for (const [key, m] of this.lineMats) {
        if (m.dashed) m.dashOffset -= dt * (key.includes("supersedes") ? 9 : 14);
      }
    }
  }

  /** The topic and constellation nearest the point the camera looks at, and how much of the screen they fill. */
  private viewSample(h: number): ViewSample {
    const target = this.controls.getTarget(new THREE.Vector3(), false);
    const cam = this.camera.position;
    const flat = (x: number, z: number) => Math.hypot(x - target.x, z - target.z);
    let nearTopic: ViewSample["nearTopic"] = null;
    let best = 1.6;
    for (const t of this.topics) {
      const p = this.layout.topics.get(t.slug)!;
      const d = flat(p.x, p.z) / p.r;
      if (d < best) {
        best = d;
        nearTopic = { slug: t.slug, constellation: t.constellation, size: (this.topicPx.get(t.slug) ?? 0) / h };
      }
    }
    const conSize = (id: string) => {
      const p = this.layout.constellations.get(id);
      return p ? projectedRadius(p.r, cam.distanceTo(new THREE.Vector3(p.x, p.y, p.z)), h, this.camera.fov) / h : 0;
    };
    let nearConstellation: ViewSample["nearConstellation"] = null;
    best = 1.3;
    for (const c of this.world.constellations) {
      const p = this.layout.constellations.get(c.id)!;
      const d = flat(p.x, p.z) / p.r;
      if (d < best) {
        best = d;
        nearConstellation = { id: c.id, size: conSize(c.id) };
      }
    }
    return {
      nearTopic,
      nearConstellation,
      focusTopicSize: this.focus.topic ? (this.topicPx.get(this.focus.topic) ?? 0) / h : 0,
      focusConstellationSize: this.focus.constellation ? conSize(this.focus.constellation) : 0,
      multi: this.world.constellations.length > 1,
      only: this.world.constellations.length === 1 ? this.world.constellations[0].id : undefined,
    };
  }

  private updateLod(): void {
    const h = this.container.clientHeight || 1;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    const sphere = new THREE.Sphere();
    const cands = this.topics.map((t) => {
      const p = this.layout.topics.get(t.slug)!;
      sphere.center.set(p.x, p.y, p.z);
      sphere.radius = p.r;
      const px = projectedRadius(p.r, this.camera.position.distanceTo(sphere.center), h, this.camera.fov);
      this.topicPx.set(t.slug, px);
      return { slug: t.slug, px, visible: frustum.intersectsSphere(sphere) };
    });
    this.events.view(this.viewSample(h), this.userDriven);
    const current = new Set([...this.revealed].filter(([, l]) => l.target > 0).map(([s]) => s));
    const next = chooseRevealed(cands, current);
    if (this.focus.topic) next.add(this.focus.topic);
    if (this.run) for (const s of Object.keys(this.run.topics)) if ((this.topicPx.get(s) ?? 0) > 40) next.add(s);
    let changed = false;
    for (const slug of next) {
      const layer = this.revealed.get(slug);
      if (!layer) void this.reveal(slug);
      else if (layer.target === 0) {
        changed = true;
        layer.target = 1;
      }
    }
    for (const [slug, layer] of this.revealed) {
      if (!next.has(slug) && layer.target !== 0) {
        layer.target = 0;
        changed = true;
      }
    }
    if (changed) this.refreshGroups();
  }

  private updateLabels(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const cands: LabelCandidate[] = [];
    const cam = this.camera.position;
    const level = levelOf(this.focus);
    const scale = h / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    const inbox = this.layout.inbox;
    const inboxPx = projectedRadius(inbox.r, cam.distanceTo(new THREE.Vector3(inbox.x, inbox.y, inbox.z)), h, this.camera.fov);
    if (inboxPx > 6) {
      cands.push({ key: "inbox", kind: "inbox", text: "Inbox", sub: `${this.world.episodes.count} pending`, color: "#ffd88a", pos: new THREE.Vector3(inbox.x, inbox.y, inbox.z), priority: 7000, lift: Math.min(inboxPx, 60) * 0.6 });
    }
    if (this.world.constellations.length > 1) {
      for (const c of this.world.constellations) {
        if (this.focus.constellation === c.id && level !== "galaxy") continue;
        const p = this.layout.constellations.get(c.id)!;
        const pos = new THREE.Vector3(p.x, p.y, p.z);
        const px = projectedRadius(p.r, cam.distanceTo(pos), h, this.camera.fov);
        if (px < 16 || px > 1500) continue;
        cands.push({ key: `c:${c.id}`, kind: "constellation", text: shortTitle(c.title), sub: `${c.topics.length} topics`, color: c.color, pos, priority: 6000 + px, lift: Math.min(px * 0.55, 120), emphasis: this.hoverTopics.has(c.id) });
      }
    }
    for (const t of this.topics) {
      const px = this.topicPx.get(t.slug) ?? 0;
      const focused = this.focus.topic === t.slug;
      const layer = this.revealed.get(t.slug);
      if (px < (level === "galaxy" && this.world.constellations.length > 1 ? 15 : 8) && !focused) continue;
      if (layer && layer.fade > 0.5 && px > (focused ? 220 : 520)) continue;
      const p = this.layout.topics.get(t.slug)!;
      const inFocusC = !this.focus.constellation || t.constellation === this.focus.constellation;
      const changed = this.run?.topics[t.slug];
      cands.push({
        key: `t:${t.slug}`,
        kind: "topic",
        text: t.title,
        sub: changed ? `${changed} changed` : t.flagged ? `${t.notes} · ${t.flagged}⚑` : `${t.notes}`,
        color: t.color,
        pos: new THREE.Vector3(p.x, p.y, p.z),
        priority: (focused ? 9000 : 3000) + px * 2 + (inFocusC ? 400 : 0) + (this.health && t.flagged ? 600 : 0) + (changed ? 5000 : 0) + (this.hoverTopics.has(t.slug) ? 6000 : 0),
        lift: Math.min(px, 140) * 0.62,
        emphasis: focused || !!changed || this.hovered === `t:${t.slug}` || this.hoverTopics.has(t.slug),
      });
    }
    const v = new THREE.Vector3();
    const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    for (const layer of this.revealed.values()) {
      if (layer.fade < 0.5 || (this.topicPx.get(layer.slug) ?? 0) < 200) continue;
      for (const b of layer.branches) {
        const state = b.note ? Math.max(this.neighborhood.get(b.note) ?? 0, this.hoverEnds.has(b.note) ? 2 : 0) : 0;
        const hovered = !!b.note && this.hovered === `n:${b.note}`;
        cands.push({
          key: `b:${layer.slug}:${b.key}`,
          kind: "branch",
          text: b.label,
          sub: `${b.count}`,
          pos: new THREE.Vector3(b.position[0] + layer.center.x, b.position[1] + layer.center.y, b.position[2] + layer.center.z),
          priority: state >= 2 || hovered ? 12000 : 5200 + b.count * 8 - b.depth * 300,
          lift: 10,
          emphasis: state >= 2 || hovered,
        });
      }
      // Every star in view competes for a label, the biggest on screen first; a fixed shortlist
      // of the best-linked notes left the ones being zoomed into unlabeled.
      layer.nodes.forEach((nd, i) => {
        if (layer.branchNotes.has(nd.id)) return; // labeled as its branch above
        v.set(layer.world[i * 3], layer.world[i * 3 + 1], layer.world[i * 3 + 2]);
        if (!view.containsPoint(v)) return;
        const d = cam.distanceTo(v);
        const starPx = (layer.sizes[i] * scale) / Math.max(d, 1);
        const hoverEnd = this.hoverEnds.has(nd.id);
        const state = Math.max(this.neighborhood.get(nd.id) ?? 0, hoverEnd ? 2 : 0);
        const hub = nd.id === layer.data.hub;
        if (starPx < 3.5 && state < 2 && !hub) return;
        const flagged = nd.flags.length > 0;
        const priority = hoverEnd ? 12500 : state === 3 ? 12000 : state === 2 ? 8500 : hub ? 6500 : (flagged ? 2500 : 1000) + nd.degree * 20 + starPx * 10;
        cands.push({
          key: `n:${nd.id}`,
          kind: hub ? "hub" : "note",
          text: nd.title,
          sub: hub ? "index" : undefined,
          color: flagged ? "#ff6b7a" : undefined,
          pos: v.clone(),
          priority,
          lift: starPx / 2 + 6,
          emphasis: state >= 2 || this.hovered === `n:${nd.id}`,
        });
      });
    }
    this.labels.update(cands, this.camera, w, h);
  }

  // --- pointer -----------------------------------------------------------------------------

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.inside = true;
      if (this.pointer.down && Math.hypot(e.clientX - this.pointer.dx, e.clientY - this.pointer.dy) > 5) this.pointer.moved = true;
      this.pointer.dirty = true;
    });
    el.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      this.hovered = null;
      this.events.hover(null, 0, 0);
    });
    el.addEventListener("pointerdown", (e) => {
      this.pointer.down = true;
      this.pointer.moved = false;
      this.pointer.dx = e.clientX;
      this.pointer.dy = e.clientY;
    });
    el.addEventListener("pointerup", (e) => {
      const click = this.pointer.down && !this.pointer.moved && e.button === 0;
      this.pointer.down = false;
      if (!click) return;
      const r = el.getBoundingClientRect();
      this.events.select(this.pick(e.clientX - r.left, e.clientY - r.top));
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private hover(): void {
    if (!this.pointer.inside || this.pointer.down) return;
    const picked = this.pickDetailed(this.pointer.x, this.pointer.y);
    const key = picked?.key ?? null;
    this.renderer.domElement.style.cursor = picked ? "pointer" : "";
    if (key !== this.hovered) {
      this.hovered = key;
      this.setHighlight(picked);
    }
    this.events.hover(picked?.target ?? null, this.pointer.x, this.pointer.y);
  }

  /** Light the hovered link or flow and both of its ends. */
  private setHighlight(picked: Picked | null): void {
    if (this.hoverLine) {
      this.scene.remove(this.hoverLine);
      this.hoverLine.geometry.dispose();
      this.hoverLine = null;
    }
    const ends = new Set<string>();
    const topics = new Set<string>();
    const t = picked?.target;
    if (t?.kind === "link") {
      ends.add(t.from.id).add(t.to.id);
    } else if (t?.kind === "flow") {
      topics.add(t.a).add(t.b);
    }
    if (picked?.segments) {
      const c = rgb(picked.color ?? "#e8f0ff").map((v) => Math.min(1.8, v * 1.6));
      const colors: number[] = [];
      for (let i = 0; i < picked.segments.length / 3; i++) colors.push(c[0], c[1], c[2]);
      this.hoverLine = this.segments(picked.segments, colors, this.lineMaterial("hover", 4.5, 1, false));
      this.hoverLine.renderOrder = 10;
      this.scene.add(this.hoverLine);
    }
    const changed = ends.size !== this.hoverEnds.size || [...ends].some((id) => !this.hoverEnds.has(id));
    this.hoverEnds = ends;
    this.hoverTopics = topics;
    if (changed) this.refreshStates();
  }

  pick(x: number, y: number): Target | null {
    return this.pickDetailed(x, y)?.target ?? null;
  }

  /**
   * Links within a few pixels of the pointer: the selected note's relations first, then the
   * trails inside revealed topics, then flows between topics or constellations.
   */
  private pickLink(x: number, y: number, toScreen: (px: number, py: number, pz: number) => readonly [number, number] | null): Picked | null {
    const near = (ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const u = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      return Math.hypot(ax + u * dx - x, ay + u * dy - y);
    };
    const linkKey = (family: Family, from: LinkEnd, to: LinkEnd) => `l:${family}:${from.id}>${to.id}`;
    let best: Picked | null = null;
    let bestD = 6;
    for (const h of this.focusHits) {
      if (!this.layers[h.family]) continue;
      const a = toScreen(h.a[0], h.a[1], h.a[2]);
      const b = toScreen(h.b[0], h.b[1], h.b[2]);
      if (!a || !b) continue;
      const d = near(a[0], a[1], b[0], b[1]);
      if (d < bestD) {
        bestD = d;
        best = { target: { kind: "link", family: h.family, from: h.from, to: h.to }, key: linkKey(h.family, h.from, h.to), segments: [...h.a, ...h.b], color: FAMILY_COLORS[h.family] };
      }
    }
    if (best) return best;
    bestD = 5;
    for (const layer of this.revealed.values()) {
      if (layer.fade < 0.5) continue;
      const screen: (readonly [number, number] | null)[] = layer.ids.map((_, i) => toScreen(layer.world[i * 3], layer.world[i * 3 + 1], layer.world[i * 3 + 2]));
      for (const l of layer.data.links) {
        const fam = familyOf(l.rel, l.source, l.target);
        if (!fam || fam[0] === "part_of" || !this.layers[fam[0]]) continue;
        const ia = layer.index.get(fam[1]);
        const ib = layer.index.get(fam[2]);
        if (ia === undefined || ib === undefined || ia === ib) continue;
        const a = screen[ia];
        const b = screen[ib];
        if (!a || !b) continue;
        const d = near(a[0], a[1], b[0], b[1]);
        if (d < bestD) {
          bestD = d;
          const from: LinkEnd = { id: fam[1], title: layer.nodes[ia].title, topic: layer.slug };
          const to: LinkEnd = { id: fam[2], title: layer.nodes[ib].title, topic: layer.slug };
          const w = layer.world;
          best = {
            target: { kind: "link", family: fam[0], from, to },
            key: linkKey(fam[0], from, to),
            segments: [w[ia * 3], w[ia * 3 + 1], w[ia * 3 + 2], w[ib * 3], w[ib * 3 + 1], w[ib * 3 + 2]],
            color: FAMILY_COLORS[fam[0]],
          };
        }
      }
    }
    if (best) return best;
    bestD = 5;
    for (const h of this.flowHits) {
      let prev = toScreen(h.points[0].x, h.points[0].y, h.points[0].z);
      for (let k = 1; k < h.points.length; k++) {
        const cur = toScreen(h.points[k].x, h.points[k].y, h.points[k].z);
        if (prev && cur) {
          const d = near(prev[0], prev[1], cur[0], cur[1]);
          if (d < bestD) {
            bestD = d;
            const segments: number[] = [];
            for (let j = 0; j < h.points.length - 1; j++) segments.push(...h.points[j].toArray(), ...h.points[j + 1].toArray());
            best = { target: { kind: "flow", level: h.level, a: h.a, b: h.b, total: h.total, rels: h.rels }, key: `f:${h.a}|${h.b}`, segments };
          }
        }
        prev = cur;
      }
    }
    return best;
  }

  /** Screen-space picking: stars first, then links, then nebulae, the inbox, and constellations. */
  private pickDetailed(x: number, y: number): Picked | null {
    const wrap = (t: Target | null): Picked | null =>
      t && { target: t, key: t.kind === "topic" ? `t:${t.slug}` : t.kind === "constellation" ? `c:${t.id}` : "inbox" };
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const scale = h / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    const v = new THREE.Vector3();
    const toScreen = (px: number, py: number, pz: number) => {
      v.set(px, py, pz).project(this.camera);
      if (v.z > 1) return null;
      return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h] as const;
    };
    let best: Target | null = null;
    let bestD = Infinity;
    for (const layer of this.revealed.values()) {
      if (layer.fade < 0.3) continue;
      for (let i = 0; i < layer.ids.length; i++) {
        const s = toScreen(layer.world[i * 3], layer.world[i * 3 + 1], layer.world[i * 3 + 2]);
        if (!s) continue;
        const dist = this.camera.position.distanceTo(v.set(layer.world[i * 3], layer.world[i * 3 + 1], layer.world[i * 3 + 2]));
        const rpx = Math.max(7, ((layer.sizes[i] * scale) / Math.max(dist, 1)) * 0.5 + 3);
        const d = Math.hypot(s[0] - x, s[1] - y);
        if (d < rpx && d < bestD) {
          bestD = d;
          best = { kind: "note", id: layer.ids[i], topic: layer.slug };
        }
      }
    }
    if (best) return { target: best, key: `n:${best.id}` };
    const link = this.pickLink(x, y, toScreen);
    if (link) return link;
    let bestScore = Infinity;
    for (const t of this.topics) {
      const p = this.layout.topics.get(t.slug)!;
      const s = toScreen(p.x, p.y, p.z);
      if (!s) continue;
      const px = Math.max(10, (this.topicPx.get(t.slug) ?? 0) * 0.7);
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d < px && d / px < bestScore) {
        bestScore = d / px;
        best = { kind: "topic", slug: t.slug };
      }
    }
    const inbox = this.layout.inbox;
    const si = toScreen(inbox.x, inbox.y, inbox.z);
    if (si) {
      const px = Math.max(12, projectedRadius(inbox.r, this.camera.position.distanceTo(v.set(inbox.x, inbox.y, inbox.z)), h, this.camera.fov));
      const d = Math.hypot(si[0] - x, si[1] - y);
      if (d < px && d / px < bestScore) {
        bestScore = d / px;
        best = { kind: "inbox" };
      }
    }
    if (best) return wrap(best);
    if (this.world.constellations.length > 1) {
      for (const c of this.world.constellations) {
        const p = this.layout.constellations.get(c.id)!;
        const s = toScreen(p.x, p.y, p.z);
        if (!s) continue;
        const px = projectedRadius(p.r, this.camera.position.distanceTo(v.set(p.x, p.y, p.z)), h, this.camera.fov) * 0.8;
        const d = Math.hypot(s[0] - x, s[1] - y);
        if (d < px && d / px < bestScore) {
          bestScore = d / px;
          best = { kind: "constellation", id: c.id };
        }
      }
    }
    return wrap(best);
  }

  /** Screen position of a target, for tests and for anchoring overlays. */
  screenOf(t: Target): { x: number; y: number } | null {
    let p: THREE.Vector3 | null = null;
    if (t.kind === "topic") {
      const q = this.layout.topics.get(t.slug);
      if (q) p = new THREE.Vector3(q.x, q.y, q.z);
    } else if (t.kind === "constellation") {
      const q = this.layout.constellations.get(t.id);
      if (q) p = new THREE.Vector3(q.x, q.y, q.z);
    } else if (t.kind === "note") {
      const layer = this.revealed.get(t.topic);
      const i = layer?.index.get(t.id);
      if (layer && i !== undefined) p = new THREE.Vector3(layer.world[i * 3], layer.world[i * 3 + 1], layer.world[i * 3 + 2]);
    } else if (t.kind === "inbox") {
      const q = this.layout.inbox;
      p = new THREE.Vector3(q.x, q.y, q.z);
    }
    if (!p) return null;
    p.project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.container.clientWidth, y: (-p.y * 0.5 + 0.5) * this.container.clientHeight };
  }

  /** A note's title, if its topic is loaded. */
  noteTitle(id: string): string | undefined {
    for (const layer of this.revealed.values()) {
      const i = layer.index.get(id);
      if (i !== undefined) return layer.nodes[i].title;
    }
    return undefined;
  }

  revealedTopics(): string[] {
    return [...this.revealed].filter(([, l]) => l.target > 0).map(([s]) => s);
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("wheel", this.wheel);
    for (const layer of this.revealed.values()) this.disposeLayer(layer);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
