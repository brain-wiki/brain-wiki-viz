import type { Focus } from "./lod";

/** One place the user opened: a constellation, topic, note, or the whole galaxy. */
export interface Visit {
  hash: string;
  focus: Focus;
  /** Remembered so the list can name notes whose topic is no longer loaded. */
  title?: string;
}

export interface TrailState {
  entries: Visit[];
  index: number;
}

const MAX = 100;

/**
 * The stack of places opened in this tab, mirroring the browser's session history: back and
 * forward move the index, and opening something new drops whatever was ahead of it.
 */
export class Trail {
  entries: Visit[];
  index: number;

  constructor(state?: TrailState) {
    this.entries = state?.entries ?? [];
    this.index = state ? Math.max(0, Math.min(state.index, this.entries.length - 1)) : -1;
  }

  get current(): Visit | undefined {
    return this.entries[this.index];
  }

  /** Record a new place after the current one; returns its index. Re-opening the current place is a no-op. */
  visit(v: Visit): number {
    if (this.current?.hash === v.hash) return this.index;
    this.entries = [...this.entries.slice(0, this.index + 1), v];
    if (this.entries.length > MAX) this.entries = this.entries.slice(this.entries.length - MAX);
    this.index = this.entries.length - 1;
    return this.index;
  }

  /** Swap the current entry in place (scrolling between levels), keeping what lies ahead. */
  replace(v: Visit): number {
    if (this.index < 0) return this.visit(v);
    this.entries = this.entries.map((e, i) => (i === this.index ? v : e));
    return this.index;
  }

  /** Move to an entry the browser already navigated to (back, forward, or a jump). */
  moveTo(index: number): Visit | undefined {
    if (index < 0 || index >= this.entries.length) return undefined;
    this.index = index;
    return this.current;
  }

  setTitle(hash: string, title: string): boolean {
    let changed = false;
    this.entries = this.entries.map((e) => {
      if (e.hash !== hash || e.title === title) return e;
      changed = true;
      return { ...e, title };
    });
    return changed;
  }

  get canBack(): boolean {
    return this.index > 0;
  }

  get canForward(): boolean {
    return this.index < this.entries.length - 1;
  }

  state(): TrailState {
    return { entries: this.entries, index: this.index };
  }
}
