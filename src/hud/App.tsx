import { useEffect, useRef } from "preact/hooks";
import type { Controller } from "../controller";
import { FAMILIES, FAMILY_COLORS, shortTitle, type Family, type LinkEnd, type Target } from "../scene/Galaxy";
import { useStore } from "../store";
import { Inspector } from "./Inspector";
import { Minimap } from "./Minimap";
import { Navigator } from "./Navigator";
import { Palette } from "./Palette";
import { Dot, FLAG_COLOR, FLAG_LABEL, fmt, Icon, Kbd } from "./ui";

const FAMILY_LABEL: Record<Family, string> = {
  part_of: "Part of",
  depends_on: "Depends on",
  conflicts_with: "Conflicts",
  supersedes: "Supersedes",
  related_to: "Related",
  links_to: "Body links",
};

const FAMILY_HINT: Record<Family, string> = {
  part_of: "Part of: a note belongs to its topic's hub",
  depends_on: "Depends on: pulses run from the prerequisite to what depends on it",
  conflicts_with: "Conflicts: two notes contradict each other",
  supersedes: "Supersedes: pulses run from the old note to the one that replaced it",
  related_to: "Related: a loose association, no direction",
  links_to: "Body links: wikilinks inside note text",
};

function Logo() {
  return (
    <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="lg" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff" />
          <stop offset="0.35" stop-color="#9cc3ff" />
          <stop offset="1" stop-color="#7a5cff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#lg)" />
      <ellipse cx="16" cy="16" rx="14" ry="5" fill="none" stroke="#9cc3ff" stroke-opacity="0.6" transform="rotate(-24 16 16)" />
    </svg>
  );
}

function Breadcrumb({ c }: { c: Controller }) {
  const focus = useStore(c.store, (s) => s.focus);
  const note = useStore(c.store, (s) => s.note);
  const data = useStore(c.store, (s) => s.topicData);
  const con = c.world.constellations.find((x) => x.id === focus.constellation);
  const topic = c.world.topics.find((t) => t.slug === focus.topic);
  const noteTitle = note?.title ?? data?.nodes.find((n) => n.id === focus.note)?.title;
  const crumbs: { label: string; color?: string; go: () => void; current: boolean }[] = [];
  const multi = c.world.constellations.length > 1;
  crumbs.push({ label: multi ? "Galaxy" : c.world.brain, go: () => c.focus({}), current: !focus.constellation && !focus.topic });
  if (con && multi) crumbs.push({ label: `${shortTitle(con.title)}${con.topics.length > 1 ? ` +${con.topics.length - 1}` : ""}`, color: con.color, go: () => c.focus({ constellation: con.id }), current: !focus.topic });
  if (topic) crumbs.push({ label: topic.title, color: topic.color, go: () => c.focus({ topic: topic.slug }), current: !focus.note });
  if (focus.note) crumbs.push({ label: noteTitle ?? "…", go: () => undefined, current: true });
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      {crumbs.map((cr, i) => (
        <span class="crumb-wrap" key={i}>
          {i > 0 && <span class="crumb-sep"><Icon name="chevron" /></span>}
          <button class={`crumb${cr.current ? " current" : ""}`} onClick={cr.go} aria-current={cr.current ? "page" : undefined}>
            {cr.color && <Dot color={cr.color} size={7} />}
            <span>{cr.label}</span>
          </button>
        </span>
      ))}
    </nav>
  );
}

function TopBar({ c }: { c: Controller }) {
  const w = c.world;
  const embedded = useStore(c.store, (s) => s.embedded);
  return (
    <header class="topbar">
      <div class="panel brand">
        <Logo />
        <div class="brand-text">
          <div class="brand-name">{w.brain}</div>
          <div class="brand-sub">
            brain-wiki · {w.profile === "owner" ? "owner view" : `as ${w.profile}`}
            {embedded ? " · exported" : ""}
          </div>
        </div>
      </div>
      <div class="panel crumbs-panel">
        <Breadcrumb c={c} />
      </div>
      <button class="panel search-btn" onClick={() => c.store.set({ paletteOpen: true })} aria-label="Search">
        <Icon name="search" />
        <span>Search the brain</span>
        <Kbd>/</Kbd>
      </button>
      <div class="panel totals" aria-label="Totals">
        <div><b>{fmt(w.totals.topics)}</b><span>topics</span></div>
        <div><b>{fmt(w.totals.notes)}</b><span>notes</span></div>
        <div><b>{fmt(w.totals.links)}</b><span>links</span></div>
        <div class={w.totals.flagged ? "warn" : ""}><b>{fmt(w.totals.flagged)}</b><span>flagged</span></div>
        <div class="gold"><b>{fmt(w.episodes.count)}</b><span>inbox</span></div>
      </div>
    </header>
  );
}

function Dock({ c }: { c: Controller }) {
  const layers = useStore(c.store, (s) => s.layers);
  const health = useStore(c.store, (s) => s.health);
  const labels = useStore(c.store, (s) => s.labels);
  const quality = useStore(c.store, (s) => s.quality);
  return (
    <div class="panel dock" role="toolbar" aria-label="Layers">
      <div class="dock-group">
        {FAMILIES.map((f) => (
          <button key={f} class={`layer${layers[f] ? " on" : ""}`} aria-pressed={layers[f]} onClick={() => c.setLayer(f, !layers[f])} title={FAMILY_HINT[f]}>
            <span class="swatch" style={{ background: FAMILY_COLORS[f], boxShadow: layers[f] ? `0 0 10px ${FAMILY_COLORS[f]}` : "none" }} />
            <span>{FAMILY_LABEL[f]}</span>
          </button>
        ))}
      </div>
      <div class="dock-sep" />
      <div class="dock-group">
        <button class={`layer${health ? " on health" : ""}`} aria-pressed={health} onClick={() => c.setHealth(!health)} title="Health mode (H)">
          <Icon name="health" /> <span>Health</span>
        </button>
        <button class={`layer${labels ? " on" : ""}`} aria-pressed={labels} onClick={() => c.setLabels(!labels)} title="Labels (L)">
          <Icon name="labels" /> <span>Labels</span>
        </button>
        <button class="layer" onClick={() => c.setQuality(quality === "high" ? "low" : "high")} title="Rendering quality">
          <Icon name="spark" /> <span>{quality === "high" ? "High" : "Low"}</span>
        </button>
        <button class="layer" onClick={() => c.focus({})} title="Reset view (R)">
          <Icon name="reset" /> <span>Reset</span>
        </button>
        <button class="layer" onClick={() => c.store.set({ helpOpen: true })} title="Shortcuts (?)">
          <Icon name="help" />
        </button>
      </div>
    </div>
  );
}

/** How a relation reads as a sentence: subject, verb, object, given the pulse direction from → to. */
const LINK_SENTENCE: Record<Family, { verb: string; subject: "from" | "to"; roles?: [string, string] }> = {
  depends_on: { verb: "depends on", subject: "to", roles: ["dependent", "prerequisite"] },
  supersedes: { verb: "supersedes", subject: "to", roles: ["newer", "older"] },
  conflicts_with: { verb: "conflicts with", subject: "from" },
  related_to: { verb: "is related to", subject: "from" },
  links_to: { verb: "links to", subject: "from" },
  part_of: { verb: "is part of", subject: "from" },
};

function LinkCard({ c, target, left, top }: { c: Controller; target: Extract<Target, { kind: "link" }>; left: number; top: number }) {
  const s = LINK_SENTENCE[target.family];
  const [subject, object] = s.subject === "to" ? [target.to, target.from] : [target.from, target.to];
  const end = (e: LinkEnd, role?: string) => {
    const t = c.world.topics.find((k) => k.slug === e.topic);
    return (
      <div class="link-end">
        <div class="hover-title">{e.title}</div>
        <div class="hover-line"><Dot color={t?.color ?? "#9cc3ff"} size={6} /> {t?.title ?? e.topic}{role ? ` · ${role}` : ""}</div>
      </div>
    );
  };
  const here = c.store.state.focus.note;
  const next = here === target.to.id ? target.from : target.to;
  return (
    <div class="hovercard panel" style={{ left: `${left}px`, top: `${top}px` }}>
      <div class="insp-kicker"><span class="swatch" style={{ background: FAMILY_COLORS[target.family] }} /> {FAMILY_LABEL[target.family]}</div>
      {end(subject, s.roles?.[0])}
      <div class="link-verb" style={{ color: FAMILY_COLORS[target.family] }}>{s.verb}</div>
      {end(object, s.roles?.[1])}
      <div class="hover-line link-hint">Click to go to {next.title}</div>
    </div>
  );
}

function FlowCard({ c, target, left, top }: { c: Controller; target: Extract<Target, { kind: "flow" }>; left: number; top: number }) {
  const name = (k: string) =>
    target.level === "constellation" ? shortTitle(c.world.constellations.find((x) => x.id === k)?.title ?? k) : c.world.topics.find((x) => x.slug === k)?.title ?? k;
  const f = c.store.state.focus;
  const [a, b] = f.topic === target.b || f.constellation === target.b ? [target.b, target.a] : [target.a, target.b];
  const rels = Object.entries(target.rels).sort((x, y) => y[1] - x[1]).map(([rel, n]) => `${n} ${rel.replace(/_/g, " ")}`);
  return (
    <div class="hovercard panel" style={{ left: `${left}px`, top: `${top}px` }}>
      <div class="insp-kicker">Links between {target.level === "constellation" ? "constellations" : "topics"}</div>
      <div class="hover-title">{name(a)} ↔ {name(b)}</div>
      <div class="hover-line">{target.total} typed links{rels.length ? `: ${rels.join(" · ")}` : ""}</div>
      <div class="hover-line link-hint">Click to fly to {name(b)}</div>
    </div>
  );
}

function HoverCard({ c }: { c: Controller }) {
  const hover = useStore(c.store, (s) => s.hover);
  const data = useStore(c.store, (s) => s.topicData);
  if (!hover) return null;
  const { target, x, y } = hover;
  if (target.kind === "link" || target.kind === "flow") {
    const left = Math.min(window.innerWidth - 310, x + 18);
    const top = Math.min(window.innerHeight - 200, y + 18);
    return target.kind === "link" ? <LinkCard c={c} target={target} left={left} top={top} /> : <FlowCard c={c} target={target} left={left} top={top} />;
  }
  let kicker = "";
  let title = "";
  let color = "#9cc3ff";
  let lines: string[] = [];
  let flags: string[] = [];
  if (target.kind === "constellation") {
    const con = c.world.constellations.find((k) => k.id === target.id);
    if (!con) return null;
    kicker = "Constellation";
    title = con.title;
    color = con.color;
    lines = [`${con.topics.length} topics`, "Click to fly in"];
  } else if (target.kind === "topic") {
    const t = c.world.topics.find((k) => k.slug === target.slug);
    if (!t) return null;
    kicker = "Topic";
    title = t.title;
    color = t.color;
    lines = [`${t.notes} notes${t.recent ? ` · ${t.recent} this week` : ""}`, t.flagged ? `${t.flagged} flagged` : "No open issues"];
  } else if (target.kind === "note") {
    const t = c.world.topics.find((k) => k.slug === target.topic);
    const nodes = data?.slug === target.topic ? data.nodes : undefined;
    const n = nodes?.find((k) => k.id === target.id);
    kicker = t?.title ?? "Note";
    color = t?.color ?? color;
    title = n?.title ?? "Note";
    if (n) {
      lines = [[n.kind === "hub" ? "hub" : n.type, n.status !== "active" ? n.status : null, `${n.degree} links`].filter(Boolean).join(" · ")];
      flags = n.flags;
    }
  } else {
    kicker = "Inbox";
    title = `${c.world.episodes.count} pending episodes`;
    color = "#ffd88a";
    lines = ["Raw observations waiting for consolidation"];
  }
  const left = Math.min(window.innerWidth - 300, x + 18);
  const top = Math.min(window.innerHeight - 140, y + 18);
  return (
    <div class="hovercard panel" style={{ left: `${left}px`, top: `${top}px` }}>
      <div class="insp-kicker"><Dot color={color} size={7} /> {kicker}</div>
      <div class="hover-title">{title}</div>
      {lines.map((l) => <div class="hover-line" key={l}>{l}</div>)}
      {flags.length > 0 && (
        <div class="hover-flags">
          {flags.map((f) => <span key={f} style={{ color: FLAG_COLOR[f as keyof typeof FLAG_COLOR] }}>● {FLAG_LABEL[f as keyof typeof FLAG_LABEL]}</span>)}
        </div>
      )}
    </div>
  );
}

function Help({ c }: { c: Controller }) {
  const rows: [string, string][] = [
    ["/  or  Ctrl/⌘ K", "Search notes, topics and constellations"],
    ["Click", "Fly to a constellation, topic or note"],
    ["Scroll", "Zoom toward the cursor; detail appears as you get closer"],
    ["Drag", "Pan across the map"],
    ["Moving pulses", "Direction: prerequisite → dependent (blue), old → new (amber)"],
    ["Hover a trail", "See the two notes it connects; click to go to the other end"],
    ["Esc", "Up one level, or close"],
    ["H", "Health mode"],
    ["L", "Labels"],
    ["R", "Reset view"],
    ["[  ]", "Previous or next topic in the constellation"],
  ];
  return (
    <div class="palette-scrim" onClick={(e) => e.target === e.currentTarget && c.store.set({ helpOpen: false })}>
      <div class="panel help" role="dialog" aria-label="Shortcuts">
        <h3>Shortcuts</h3>
        {rows.map(([k, v]) => (
          <div class="help-row" key={k}>
            <Kbd>{k}</Kbd>
            <span>{v}</span>
          </div>
        ))}
        <p class="hint">Star size shows how connected a note is, brightness how recently it changed. Rings mark health flags.</p>
      </div>
    </div>
  );
}

export function App({ c }: { c: Controller }) {
  const stage = useRef<HTMLDivElement>(null);
  const palette = useStore(c.store, (s) => s.paletteOpen);
  const help = useStore(c.store, (s) => s.helpOpen);
  const toast = useStore(c.store, (s) => s.toast);
  const run = useStore(c.store, (s) => s.run);
  const health = useStore(c.store, (s) => s.health);
  const sceneError = useStore(c.store, (s) => s.sceneError);

  useEffect(() => {
    if (stage.current && !c.galaxy) c.mount(stage.current);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA";
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        c.store.set({ paletteOpen: true });
        return;
      }
      if (e.key === "Escape") {
        if (typing) (t as HTMLInputElement).blur();
        c.up();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "h" || e.key === "H") c.setHealth(!c.store.state.health);
      else if (e.key === "l" || e.key === "L") c.setLabels(!c.store.state.labels);
      else if (e.key === "r" || e.key === "R") c.focus({});
      else if (e.key === "?") c.store.set({ helpOpen: true });
      else if (e.key === "[" || e.key === "]") {
        const f = c.store.state.focus;
        const con = c.world.constellations.find((k) => k.id === f.constellation) ?? c.world.constellations[0];
        if (!con) return;
        const list = con.topics;
        const i = f.topic ? list.indexOf(f.topic) : -1;
        const next = list[(i + (e.key === "]" ? 1 : -1) + list.length) % list.length];
        if (next) c.focus({ topic: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="app">
      <div class="stage" ref={stage} />
      {sceneError && (
        <div class="panel scene-error" role="alert">
          <h2>The 3D map could not start</h2>
          <p class="scene-error-detail">{sceneError}</p>
          <p>
            It needs WebGL2 with hardware acceleration. Turn on hardware acceleration in your browser settings, then
            check <code>chrome://gpu</code> (or <code>about:support</code> in Firefox) for WebGL2 marked hardware
            accelerated. Remote desktop sessions often have no GPU.
          </p>
          <p>The navigator, search, and inspector still work.</p>
        </div>
      )}
      <TopBar c={c} />
      <Navigator c={c} />
      <Inspector c={c} />
      {!sceneError && <Minimap c={c} />}
      <Dock c={c} />
      <HoverCard c={c} />
      {run && (
        <div class="panel run-banner">
          <span class="run-kind">{run.kind}</span> {run.at ? new Date(run.at).toLocaleString() : ""} · {run.touched.length} notes lit
          <button class="link" onClick={() => c.setRun(null)}>clear</button>
        </div>
      )}
      {health && (
        <div class="panel health-legend" role="note" aria-label="Health mode legend">
          <span>Fewest flags</span>
          <span class="health-ramp" />
          <span>Most flags</span>
          <span class="dock-sep" />
          <span class="ring" /> <span>flagged note</span>
          <span class="dock-sep" />
          <Kbd>H</Kbd> <span>exit</span>
        </div>
      )}
      {palette && <Palette c={c} />}
      {help && <Help c={c} />}
      {toast && <div class="panel toast" role="status">{toast}</div>}
    </div>
  );
}
