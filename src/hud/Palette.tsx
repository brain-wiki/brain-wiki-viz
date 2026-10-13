import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Controller } from "../controller";
import type { SearchHit } from "../types";
import { Dot, Icon, Kbd } from "./ui";

interface Item {
  key: string;
  kind: "constellation" | "topic" | "note";
  title: string;
  sub: string;
  color: string;
  run(): void;
}

/** Ctrl/⌘-K: topics and constellations match instantly; notes come from the index search. */
export function Palette({ c }: { c: Controller }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const topics = useMemo(() => new Map(c.world.topics.map((t) => [t.slug, t])), [c]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setHits([]);
      return;
    }
    setBusy(true);
    const id = window.setTimeout(() => {
      c.search(needle)
        .then((r) => setHits(r))
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 140);
    return () => window.clearTimeout(id);
  }, [q]);

  const close = () => c.store.set({ paletteOpen: false });
  const needle = q.trim().toLowerCase();
  const items: Item[] = [];
  if (needle) {
    for (const con of c.world.constellations) {
      if (c.world.constellations.length > 1 && con.title.toLowerCase().includes(needle)) {
        items.push({ key: `c:${con.id}`, kind: "constellation", title: con.title, sub: `${con.topics.length} topics`, color: con.color, run: () => c.focus({ constellation: con.id }) });
      }
    }
    for (const t of c.world.topics) {
      if (t.title.toLowerCase().includes(needle) || t.slug.includes(needle)) {
        items.push({ key: `t:${t.slug}`, kind: "topic", title: t.title, sub: `${t.notes} notes`, color: t.color, run: () => c.focus({ topic: t.slug }) });
      }
      if (items.length > 8) break;
    }
    for (const h of hits) {
      const t = h.topic ? topics.get(h.topic) : undefined;
      items.push({ key: `n:${h.id}`, kind: "note", title: h.title, sub: [t?.title, h.snippet].filter(Boolean).join(" · "), color: t?.color ?? "#8892b0", run: () => c.openNote(h.id, h.topic) });
    }
  } else {
    // Empty query: the busiest topics, a quick way in.
    for (const t of [...c.world.topics].sort((a, b) => b.notes - a.notes).slice(0, 8)) {
      items.push({ key: `t:${t.slug}`, kind: "topic", title: t.title, sub: `${t.notes} notes`, color: t.color, run: () => c.focus({ topic: t.slug }) });
    }
  }
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    close();
    it.run();
  };

  return (
    <div class="palette-scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="palette panel" role="dialog" aria-label="Search notes and topics">
        <div class="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            placeholder="Search notes and topics…"
            aria-label="Search"
            onInput={(e) => {
              setQ((e.target as HTMLInputElement).value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel(Math.min(items.length - 1, sel + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel(Math.max(0, sel - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(sel);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          {busy && <span class="spinner" />}
          <Kbd>esc</Kbd>
        </div>
        <div class="palette-results" role="listbox">
          {!needle && <div class="palette-section">Largest topics</div>}
          {items.map((it, i) => (
            <button key={it.key} role="option" aria-selected={i === sel} class={`palette-item${i === sel ? " sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              <Dot color={it.color} size={8} />
              <span class={`palette-kind kind-${it.kind}`}>{it.kind === "constellation" ? "group" : it.kind}</span>
              <span class="palette-title">{it.title}</span>
              <span class="palette-sub">{it.sub}</span>
            </button>
          ))}
          {needle && !busy && items.length === 0 && <div class="empty">Nothing matches “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}
