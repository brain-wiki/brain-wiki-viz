import type { Source } from "./api";
import { Trail, type TrailState } from "./history";
import { focusToHash, hashToFocus, levelOf, parentFocus, viewFocus, type Focus, type ViewSample } from "./lod";
import { FAMILIES, Galaxy, type Layers, type Quality, type QualityMode, type Target } from "./scene/Galaxy";
import { Store } from "./store";
import type { Health, NoteDetail, RunSummary, SearchHit, TopicData, World } from "./types";

export type NavTab = "atlas" | "health" | "changes";

export interface AppState {
  world: World;
  focus: Focus;
  hover: { target: Target; x: number; y: number } | null;
  note: NoteDetail | null;
  topicData: TopicData | null;
  layers: Layers;
  health: boolean;
  labels: boolean;
  /** What is drawn now, and what the user chose (Auto measures the GPU). */
  quality: Quality;
  qualityMode: QualityMode;
  navOpen: boolean;
  navTab: NavTab;
  paletteOpen: boolean;
  helpOpen: boolean;
  healthData: Health | null;
  run: RunSummary | null;
  toast: string | null;
  embedded: boolean;
  /** Why the 3D scene could not start; the HUD keeps working without it. */
  sceneError: string | null;
  /** The selected note's rendered preview is open. */
  previewOpen: boolean;
  /** Places opened in this tab, for back, forward, and the history list. */
  trail: TrailState;
  historyOpen: boolean;
  /** Where the view sits between levels, 0 (galaxy) to 3 (note), for the level indicator. */
  zoom: number;
}

/** Glue between the scene, the HUD and the data source; the HUD only calls these methods. */
export class Controller {
  readonly store: Store<AppState>;
  galaxy: Galaxy | null = null;
  private toastTimer = 0;
  private noteSeq = 0;
  private constellationOf: Map<string, string>;
  private trail: Trail;

  constructor(
    readonly source: Source,
    readonly world: World,
  ) {
    this.constellationOf = new Map(world.topics.map((t) => [t.slug, t.constellation]));
    this.trail = new Trail(restoreTrail(`brainviz.trail:${world.brain}:${location.pathname}`));
    // Low by default: the map reads fine without glow and runs on any GPU. A ?quality= URL wins,
    // then the user's last choice.
    const asked = new URLSearchParams(location.search).get("quality");
    const mode: QualityMode = isQualityMode(asked) ? asked : (savedGraphics() ?? "low");
    this.store = new Store<AppState>({
      world,
      focus: {},
      hover: null,
      note: null,
      topicData: null,
      // Part of (spokes to the hub) repeats what clustering already shows; wikilinks are noisy.
      layers: Object.fromEntries(FAMILIES.map((f) => [f, f !== "links_to"])) as Layers,
      health: false,
      labels: true,
      quality: mode === "low" ? "low" : "high",
      qualityMode: mode,
      navOpen: true,
      navTab: "atlas",
      paletteOpen: false,
      helpOpen: false,
      healthData: null,
      run: null,
      toast: null,
      embedded: source.embedded,
      sceneError: null,
      previewOpen: false,
      trail: this.trail.state(),
      historyOpen: false,
      zoom: 0,
    });
  }

  mount(container: HTMLElement): void {
    try {
      this.galaxy = new Galaxy(container, this.world, this.source, {
        hover: (target, x, y) => this.store.set({ hover: target ? { target, x, y } : null }),
        select: (t) => this.select(t),
        view: (sample, userDriven) => this.onView(sample, userDriven),
        quality: (quality, auto) => {
          this.store.set({ quality });
          if (auto && quality === "low") this.toast("Graphics set to Low: frames were slow on this GPU, so the glow is off. Change it in the ⋯ menu.");
        },
      }, this.store.state.qualityMode);
      this.galaxy.setLayers(this.store.state.layers);
    } catch (err) {
      // Usually no WebGL2 (hardware acceleration off, remote desktop); say so instead of a blank stage.
      container.replaceChildren();
      this.store.set({ sceneError: err instanceof Error ? err.message : String(err) });
      console.error("brain viz: the 3D scene could not start", err);
    }
    // The trail mirrors the browser's session history: each entry carries its trail index in
    // history.state, so the browser's own back/forward (and mouse buttons) stay in step.
    window.addEventListener("popstate", (e) => this.onHistory(e.state));
    window.addEventListener("hashchange", () => this.onHistory(history.state));
    this.onHistory(history.state);
    (window as unknown as { __brainViz: unknown }).__brainViz = { controller: this, galaxy: this.galaxy, ready: true };
    document.body.dataset.ready = "1";
  }

  /** The browser moved (back, forward, a typed address, or the first load): follow it. */
  private onHistory(state: unknown): void {
    this.applyHash();
    const f = this.store.state.focus;
    const hash = focusToHash(f);
    const i = (state as { brainViz?: number } | null)?.brainViz;
    if (typeof i === "number" && this.trail.entries[i]?.hash === hash) {
      this.trail.moveTo(i);
    } else {
      // An entry we did not create (a typed address, a fresh tab): record it and tag it.
      const at = this.trail.visit({ hash, focus: f, title: this.titleOf(f) });
      history.replaceState({ brainViz: at }, "", hash);
    }
    this.syncTrail();
  }

  back(): void {
    if (this.trail.canBack) history.back();
  }

  forward(): void {
    if (this.trail.canForward) history.forward();
  }

  /** Jump to any entry in the trail, the way a browser's history list does. */
  jump(index: number): void {
    const delta = index - this.trail.index;
    this.store.set({ historyOpen: false });
    if (delta) history.go(delta);
  }

  private syncTrail(): void {
    this.store.set({ trail: this.trail.state() });
    try {
      sessionStorage.setItem(this.trailKey(), JSON.stringify(this.trail.state()));
    } catch {
      // Storage can be unavailable (private mode, file:// exports); the trail still works in memory.
    }
  }

  private trailKey(): string {
    return `brainviz.trail:${this.world.brain}:${location.pathname}`;
  }

  private titleOf(f: Focus): string | undefined {
    if (f.note) return this.galaxy?.noteTitle(f.note) ?? this.store?.state.topicData?.nodes.find((n) => n.id === f.note)?.title;
    return undefined;
  }

  private applyHash(): void {
    const f = hashToFocus(location.hash, (s) => this.constellationOf.get(s));
    if (focusToHash(f) !== focusToHash(this.store.state.focus) || !this.store.state.focus.constellation) this.focus(f, "none");
  }

  /**
   * Change what is focused. Clicks and keys `push` a history entry and fly the camera; scrolling
   * `replace`s the current entry and leaves the camera where the user put it; following the
   * browser's own history records nothing (`none`).
   */
  focus(f: Focus, history_: "push" | "replace" | "none" = "push", fly = true): void {
    if (f.topic && !f.constellation) f = { ...f, constellation: this.constellationOf.get(f.topic) };
    const prev = this.store.state.focus;
    this.store.set({ focus: f, hover: null });
    this.galaxy?.setFocus(f, fly);
    const hash = focusToHash(f);
    if (history_ !== "none" && hash !== location.hash) {
      const visit = { hash, focus: f, title: this.titleOf(f) };
      if (history_ === "push") history.pushState({ brainViz: this.trail.visit(visit) }, "", hash);
      else history.replaceState({ brainViz: this.trail.replace(visit) }, "", hash);
      this.syncTrail();
    }
    if (f.topic && f.topic !== prev.topic) {
      this.store.set({ topicData: null });
      void this.source.topic(f.topic).then((data) => {
        if (this.store.state.focus.topic === f.topic) this.store.set({ topicData: data });
      });
    } else if (!f.topic) {
      this.store.set({ topicData: null });
    }
    if (f.note) {
      const seq = ++this.noteSeq;
      if (f.note !== prev.note) this.store.set({ note: null });
      void this.source.note(f.note).then((note) => {
        if (seq === this.noteSeq) this.store.set({ note });
        if (note && this.trail.setTitle(focusToHash(f), note.title)) this.syncTrail();
      });
    } else {
      this.store.set({ note: null, previewOpen: false });
    }
  }

  up(): void {
    const s = this.store.state;
    if (s.paletteOpen) return this.store.set({ paletteOpen: false });
    if (s.historyOpen) return this.store.set({ historyOpen: false });
    if (s.helpOpen) return this.store.set({ helpOpen: false });
    if (s.previewOpen) return this.store.set({ previewOpen: false });
    if (s.run) return this.setRun(null);
    if (levelOf(s.focus) === "galaxy") return this.galaxy?.resetView();
    this.focus(parentFocus(s.focus));
  }

  select(t: Target | null): void {
    if (!t) return;
    if (t.kind === "constellation") this.focus({ constellation: t.id });
    else if (t.kind === "topic") this.focus({ topic: t.slug });
    else if (t.kind === "note") this.openNote(t.id, t.topic);
    else if (t.kind === "link") {
      // Go to the end you are not already on.
      const end = this.store.state.focus.note === t.to.id ? t.from : t.to;
      this.focus({ topic: end.topic, note: end.id });
    } else if (t.kind === "flow") {
      const f = this.store.state.focus;
      if (t.level === "constellation") this.focus({ constellation: f.constellation === t.b ? t.a : t.b });
      else this.focus({ topic: f.topic === t.b ? t.a : t.b });
    } else this.toast(`${this.world.episodes.count} episodes wait in the inbox. Ask your agent to consolidate them, or run brain consolidate.`);
  }

  /** Scrolling moves between levels like zooming a map: in enters, out leaves, panning switches. */
  private onView(sample: ViewSample, userDriven: boolean): void {
    const cur = this.store.state.focus;
    const { focus, progress } = viewFocus(cur, sample);
    if (Math.abs(progress - this.store.state.zoom) > 0.02) this.store.set({ zoom: progress });
    if (userDriven && focusToHash(focus) !== focusToHash(cur)) this.focus(focus, "replace", false);
  }

  /** Select a note and open its preview: what clicking a note means everywhere in the UI. */
  openNote(id: string, topic: string | null): void {
    if (!topic) return;
    this.focus({ topic, note: id });
    this.store.set({ previewOpen: true });
  }

  setLayer(family: keyof Layers, on: boolean): void {
    const layers = { ...this.store.state.layers, [family]: on };
    this.store.set({ layers });
    this.galaxy?.setLayers(layers);
  }

  setHealth(on: boolean): void {
    this.store.set({ health: on });
    this.galaxy?.setHealth(on);
    if (on && !this.store.state.healthData) void this.loadHealth();
  }

  setLabels(on: boolean): void {
    this.store.set({ labels: on });
    this.galaxy?.setLabels(on);
  }

  setQualityMode(mode: QualityMode): void {
    this.store.set({ qualityMode: mode, ...(mode === "auto" ? {} : { quality: mode }) });
    this.galaxy?.setQualityMode(mode);
    try {
      localStorage.setItem(GRAPHICS_KEY, mode);
    } catch {
      // No storage (private mode, some file:// exports): the choice lasts for this page only.
    }
  }

  setRun(run: RunSummary | null): void {
    this.store.set({ run });
    this.galaxy?.setRun(run);
    if (run) {
      const top = Object.entries(run.topics).sort((a, b) => b[1] - a[1])[0];
      if (top) this.focus({ constellation: this.constellationOf.get(top[0]) });
    }
  }

  async loadHealth(): Promise<void> {
    const healthData = await this.source.health();
    this.store.set({ healthData });
  }

  setNav(tab: NavTab): void {
    this.store.set({ navTab: tab, navOpen: true });
    if (tab === "health" && !this.store.state.healthData) void this.loadHealth();
  }

  search(q: string): Promise<SearchHit[]> {
    return this.source.search(q);
  }

  toast(msg: string): void {
    this.store.set({ toast: msg });
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.store.set({ toast: null }), 4200);
  }
}

function restoreTrail(key: string): TrailState | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    const state = raw ? (JSON.parse(raw) as TrailState) : undefined;
    return state && Array.isArray(state.entries) && typeof state.index === "number" ? state : undefined;
  } catch {
    return undefined;
  }
}

const GRAPHICS_KEY = "brainviz.graphics";

function isQualityMode(v: string | null): v is QualityMode {
  return v === "auto" || v === "high" || v === "low";
}

function savedGraphics(): QualityMode | null {
  try {
    const v = localStorage.getItem(GRAPHICS_KEY);
    return isQualityMode(v) ? v : null;
  } catch {
    return null;
  }
}
