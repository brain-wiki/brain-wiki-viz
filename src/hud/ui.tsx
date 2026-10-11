import type { ComponentChildren } from "preact";
import type { Flag } from "../types";

export const FLAG_LABEL: Record<Flag, string> = {
  conflict: "Conflicts",
  stale: "Stale dependents",
  unverified: "Unverified claims",
  orphan: "Orphans",
  over_budget: "Over-budget hubs",
  lint_error: "Lint errors",
};

export const FLAG_COLOR: Record<Flag, string> = {
  conflict: "#ff3b4f",
  stale: "#ffad38",
  unverified: "#bd85ff",
  orphan: "#9aa6c4",
  over_budget: "#ff8030",
  lint_error: "#ff6bc6",
};

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span class="dot" style={{ background: color, width: `${size}px`, height: `${size}px`, boxShadow: `0 0 10px ${color}` }} />;
}

export function Chip({ children, tone }: { children: ComponentChildren; tone?: string }) {
  return <span class={`chip${tone ? ` chip-${tone}` : ""}`}>{children}</span>;
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="kbd">{children}</kbd>;
}

export function fmt(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}

export function Icon({ name }: { name: "search" | "layers" | "health" | "reset" | "help" | "labels" | "spark" | "close" | "chevron" | "back" | "copy" | "open" }) {
  const p: Record<string, string> = {
    search: "M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z",
    layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
    health: "M12 21s-7-4.4-9.3-9A5.2 5.2 0 0 1 12 6.3 5.2 5.2 0 0 1 21.3 12C19 16.6 12 21 12 21Z",
    reset: "M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5",
    help: "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm0-6v.01M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V13",
    labels: "M4 5h16M4 12h10M4 19h7",
    spark: "M12 2v6m0 8v6M2 12h6m8 0h6M5 5l4 4m6 6 4 4m0-14-4 4m-6 6-4 4",
    close: "M6 6l12 12M18 6 6 18",
    chevron: "m9 6 6 6-6 6",
    back: "m15 6-6 6 6 6",
    copy: "M8 8h11v11H8zM5 16V5h11",
    open: "M14 4h6v6m0-6-9 9M10 6H5v13h13v-5",
  };
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={p[name]} />
    </svg>
  );
}
