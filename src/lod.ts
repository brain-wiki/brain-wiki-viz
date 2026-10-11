// Map-style level of detail (design doc 12 §2): detail appears by on-screen size.

export const REVEAL_ON_PX = 110;
export const REVEAL_OFF_PX = 80;
export const MAX_REVEALED = 12;

/** Radius in pixels of a sphere of world radius `r` at distance `dist`. */
export function projectedRadius(r: number, dist: number, viewportH: number, fovDeg: number): number {
  if (dist <= r) return Infinity;
  return (r / dist) * (viewportH / 2) / Math.tan((fovDeg * Math.PI) / 360);
}

export interface Candidate {
  slug: string;
  px: number;
  visible: boolean;
}

/** The topics whose stars should be shown: biggest on screen first, with hysteresis. */
export function chooseRevealed(cands: Candidate[], current: Set<string>, max = MAX_REVEALED): Set<string> {
  const eligible = cands
    .filter((c) => c.visible && c.px >= (current.has(c.slug) ? REVEAL_OFF_PX : REVEAL_ON_PX))
    .sort((a, b) => b.px - a.px || a.slug.localeCompare(b.slug));
  return new Set(eligible.slice(0, max).map((c) => c.slug));
}

/**
 * Health severity per topic in [0, 1]: the rank of its flagged share among flagged topics,
 * so the worst topics stand out even when every topic has some flags. Unflagged topics are 0.
 */
export function healthSeverity(topics: { notes: number; flagged: number }[]): Float32Array {
  const out = new Float32Array(topics.length);
  const share = topics.map((t) => t.flagged / Math.max(1, t.notes));
  const ranked = topics
    .map((_, i) => i)
    .filter((i) => topics[i].flagged > 0)
    .sort((a, b) => share[a] - share[b] || a - b);
  ranked.forEach((i, k) => {
    out[i] = ranked.length === 1 ? 1 : 0.15 + 0.85 * (k / (ranked.length - 1));
  });
  return out;
}

export type Level = "galaxy" | "constellation" | "topic" | "note";

export interface Focus {
  constellation?: string;
  topic?: string;
  note?: string;
}

export function levelOf(f: Focus): Level {
  if (f.note) return "note";
  if (f.topic) return "topic";
  if (f.constellation) return "constellation";
  return "galaxy";
}

/** One level up: note → topic → constellation → galaxy. */
export function parentFocus(f: Focus): Focus {
  if (f.note) return { constellation: f.constellation, topic: f.topic };
  if (f.topic) return { constellation: f.constellation };
  return {};
}

export function focusToHash(f: Focus): string {
  if (f.note && f.topic) return `#/t/${encodeURIComponent(f.topic)}/n/${encodeURIComponent(f.note)}`;
  if (f.topic) return `#/t/${encodeURIComponent(f.topic)}`;
  if (f.constellation) return `#/c/${encodeURIComponent(f.constellation)}`;
  return "#/";
}

export function hashToFocus(hash: string, constellationOf: (slug: string) => string | undefined): Focus {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "c" && parts[1]) return { constellation: parts[1] };
  if (parts[0] === "t" && parts[1]) {
    const f: Focus = { constellation: constellationOf(parts[1]), topic: parts[1] };
    if (parts[2] === "n" && parts[3]) f.note = parts[3];
    return f;
  }
  return {};
}
