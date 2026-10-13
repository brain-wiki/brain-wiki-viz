import * as THREE from "three";

export type LabelKind = "constellation" | "topic" | "hub" | "branch" | "note" | "inbox";

export interface LabelCandidate {
  key: string;
  kind: LabelKind;
  text: string;
  sub?: string;
  color?: string;
  pos: THREE.Vector3;
  priority: number;
  /** Pixel offset above the anchor, so a label sits over its nebula or star. */
  lift?: number;
  emphasis?: boolean;
}

const CHAR_W: Record<LabelKind, number> = { constellation: 11, topic: 7.2, hub: 7.2, branch: 7, note: 6.6, inbox: 7.4 };
const HEIGHT: Record<LabelKind, number> = { constellation: 26, topic: 24, hub: 24, branch: 22, note: 20, inbox: 24 };

interface Slot {
  el: HTMLDivElement;
  text: HTMLSpanElement;
  sub: HTMLSpanElement;
  dot: HTMLSpanElement;
  key: string;
  shown: boolean;
}

/** DOM labels over the canvas: projected, sorted by priority, greedily placed without overlap. */
export class LabelLayer {
  private root: HTMLDivElement;
  private slots: Slot[] = [];
  private v = new THREE.Vector3();
  max = 90;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "labels";
    container.appendChild(this.root);
  }

  private slot(i: number): Slot {
    let s = this.slots[i];
    if (!s) {
      const el = document.createElement("div");
      const dot = document.createElement("span");
      dot.className = "lbl-dot";
      const text = document.createElement("span");
      text.className = "lbl-text";
      const sub = document.createElement("span");
      sub.className = "lbl-sub";
      el.append(dot, text, sub);
      this.root.appendChild(el);
      s = { el, text, sub, dot, key: "", shown: false };
      this.slots[i] = s;
    }
    return s;
  }

  update(cands: LabelCandidate[], camera: THREE.Camera, w: number, h: number): void {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    cands.sort((a, b) => b.priority - a.priority);
    let n = 0;
    for (const c of cands) {
      if (n >= this.max) break;
      this.v.copy(c.pos).project(camera);
      if (this.v.z > 1 || this.v.z < -1) continue;
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h - (c.lift ?? 0);
      const len = c.text.length + (c.sub ? c.sub.length + 2 : 0);
      const bw = Math.min(360, len * CHAR_W[c.kind] + 30);
      const bh = HEIGHT[c.kind];
      const box = { x0: x - bw / 2, y0: y - bh, x1: x + bw / 2, y1: y };
      if (box.x1 < 0 || box.x0 > w || box.y1 < 0 || box.y0 > h) continue;
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      placed.push(box);
      const s = this.slot(n++);
      if (s.key !== c.key) {
        s.key = c.key;
        s.el.className = `lbl lbl-${c.kind}${c.emphasis ? " lbl-emph" : ""}`;
        s.text.textContent = c.text;
        s.sub.textContent = c.sub ?? "";
        s.dot.style.background = c.color ?? "transparent";
      } else if (s.el.classList.contains("lbl-emph") !== !!c.emphasis) {
        s.el.classList.toggle("lbl-emph", !!c.emphasis);
      }
      s.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`;
      if (!s.shown) {
        s.el.style.opacity = "1";
        s.shown = true;
      }
    }
    for (let i = n; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.shown) {
        s.el.style.opacity = "0";
        s.shown = false;
        s.key = "";
      }
    }
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? "" : "none";
  }
}
