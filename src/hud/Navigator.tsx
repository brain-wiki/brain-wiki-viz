import { useMemo, useState } from "preact/hooks";
import type { Controller } from "../controller";
import { shortTitle } from "../scene/Galaxy";
import { useStore } from "../store";
import { FLAGS, type Flag, type TopicSummary } from "../types";
import { Dot, FLAG_COLOR, FLAG_LABEL, fmt, Icon } from "./ui";

type Sort = "size" | "health" | "recent" | "name";

function sorter(sort: Sort) {
  return (a: TopicSummary, b: TopicSummary) => {
    if (sort === "health") return b.flagged / Math.max(1, b.notes) - a.flagged / Math.max(1, a.notes) || b.flagged - a.flagged;
    if (sort === "recent") return (b.updated ?? "").localeCompare(a.updated ?? "") || b.recent - a.recent;
    if (sort === "name") return a.title.localeCompare(b.title);
    return b.notes - a.notes || a.title.localeCompare(b.title);
  };
}

function Atlas({ c }: { c: Controller }) {
  const world = c.world;
  const focus = useStore(c.store, (s) => s.focus);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("size");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const bySlug = useMemo(() => new Map(world.topics.map((t) => [t.slug, t])), [world]);
  const maxNotes = Math.max(1, ...world.topics.map((t) => t.notes));
  const needle = filter.trim().toLowerCase();
  const single = world.constellations.length === 1;
  return (
    <div class="atlas">
      <div class="nav-tools">
        <input class="field" placeholder="Filter topics" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} aria-label="Filter topics" />
        <select class="field select" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)} aria-label="Sort topics">
          <option value="size">Size</option>
          <option value="health">Health</option>
          <option value="recent">Recent</option>
          <option value="name">Name</option>
        </select>
      </div>
      <div class="tree" role="tree">
        {world.constellations.map((con) => {
          const topics = con.topics
            .map((s) => bySlug.get(s))
            .filter((t): t is TopicSummary => !!t && (!needle || t.title.toLowerCase().includes(needle) || t.slug.includes(needle)))
            .sort(sorter(sort));
          if (needle && topics.length === 0) return null;
          const expanded = single || !!needle || open[con.id] || focus.constellation === con.id;
          const notes = topics.reduce((s, t) => s + t.notes, 0);
          const flagged = topics.reduce((s, t) => s + t.flagged, 0);
          return (
            <div class="tree-group" key={con.id}>
              {!single && (
                <button
                  class={`tree-con${focus.constellation === con.id ? " active" : ""}`}
                  onClick={() => {
                    setOpen({ ...open, [con.id]: !expanded || focus.constellation !== con.id });
                    c.focus({ constellation: con.id });
                  }}
                  role="treeitem"
                  aria-expanded={expanded}
                >
                  <span class={`chev${expanded ? " open" : ""}`}><Icon name="chevron" /></span>
                  <Dot color={con.color} size={9} />
                  <span class="tree-title" title={con.title}>{shortTitle(con.title)}{con.topics.length > 1 ? <span class="tree-more"> +{con.topics.length - 1}</span> : null}</span>
                  <span class="tree-meta">{con.topics.length} · {fmt(notes)}{flagged ? <span class="warn"> · {flagged}⚑</span> : null}</span>
                </button>
              )}
              {expanded && (
                <div class="tree-topics">
                  {topics.map((t) => (
                    <button key={t.slug} class={`tree-topic${focus.topic === t.slug ? " active" : ""}`} onClick={() => c.focus({ topic: t.slug })} role="treeitem">
                      <Dot color={t.color} size={7} />
                      <span class="tree-title">{t.title}</span>
                      {t.flagged > 0 && <span class="badge" title={`${t.flagged} flagged notes`}>{t.flagged}</span>}
                      <span class="tree-count">{fmt(t.notes)}</span>
                      <span class="bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(4, (t.notes / maxNotes) * 100)}%`, background: t.color }} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HealthTab({ c }: { c: Controller }) {
  const data = useStore(c.store, (s) => s.healthData);
  const health = useStore(c.store, (s) => s.health);
  const [open, setOpen] = useState<Flag | null>("conflict");
  const titles = useMemo(() => new Map(c.world.topics.map((t) => [t.slug, t])), [c]);
  if (!data) return <div class="empty">Reading health…</div>;
  const flags = FLAGS.filter((f) => (data.counts[f] ?? 0) > 0);
  return (
    <div class="health">
      <label class="switch-row">
        <span>Health mode colors topics by their share of flagged notes and rings each flagged note</span>
        <input type="checkbox" class="switch" checked={health} onChange={(e) => c.setHealth((e.target as HTMLInputElement).checked)} />
      </label>
      {flags.length === 0 && <div class="empty">No open issues. The brain is healthy.</div>}
      {flags.map((f) => (
        <div class="flag-group" key={f}>
          <button class="flag-head" onClick={() => setOpen(open === f ? null : f)} aria-expanded={open === f}>
            <span class={`chev${open === f ? " open" : ""}`}><Icon name="chevron" /></span>
            <Dot color={FLAG_COLOR[f]} />
            <span class="tree-title">{FLAG_LABEL[f]}</span>
            <span class="flag-count">{fmt(data.counts[f] ?? 0)}</span>
          </button>
          {open === f && (
            <div class="flag-items">
              {(data.items[f] ?? []).map((it) => (
                <button key={it.id} class="flag-item" onClick={() => c.openNote(it.id, it.topic)}>
                  <span class="tree-title">{it.title}</span>
                  <span class="tree-meta">{it.topic ? titles.get(it.topic)?.title ?? it.topic : ""}</span>
                </button>
              ))}
              {(data.counts[f] ?? 0) > (data.items[f]?.length ?? 0) && <div class="more">and {fmt((data.counts[f] ?? 0) - (data.items[f]?.length ?? 0))} more</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Changes({ c }: { c: Controller }) {
  const run = useStore(c.store, (s) => s.run);
  const runs = c.world.runs;
  const titles = useMemo(() => new Map(c.world.topics.map((t) => [t.slug, t])), [c]);
  if (runs.length === 0) return <div class="empty">No runs recorded on this device yet.</div>;
  return (
    <div class="changes">
      <div class="hint">Select a run to light up what it changed.</div>
      {runs.map((r) => {
        const topics = Object.entries(r.topics).sort((a, b) => b[1] - a[1]);
        const when = r.at ? new Date(r.at) : null;
        return (
          <button key={r.id} class={`run${run?.id === r.id ? " active" : ""}`} onClick={() => c.setRun(run?.id === r.id ? null : r)}>
            <div class="run-top">
              <span class={`run-kind kind-${r.kind}`}>{r.kind}</span>
              <span class="run-when">{when ? when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
            </div>
            <div class="run-body">
              {r.episodes > 0 && <span>{r.episodes} episodes · </span>}
              <span>{r.touched.length} notes</span>
            </div>
            {topics.length > 0 && (
              <div class="run-topics">
                {topics.slice(0, 4).map(([slug, n]) => {
                  const t = titles.get(slug);
                  return (
                    <span class="run-topic" key={slug}>
                      <Dot color={t?.color ?? "#888"} size={6} /> {t?.title ?? slug} <b>{n}</b>
                    </span>
                  );
                })}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Navigator({ c }: { c: Controller }) {
  const tab = useStore(c.store, (s) => s.navTab);
  const open = useStore(c.store, (s) => s.navOpen);
  const flagged = c.world.totals.flagged;
  return (
    <aside class={`panel nav${open ? "" : " collapsed"}`} aria-label="Navigator">
      <div class="tabs" role="tablist">
        {(["atlas", "health", "changes"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} class={`tab${tab === t ? " active" : ""}`} onClick={() => c.setNav(t)}>
            {t === "atlas" ? "Atlas" : t === "health" ? "Health" : "Changes"}
            {t === "health" && flagged > 0 && <span class="tab-badge">{fmt(flagged)}</span>}
            {t === "changes" && c.world.runs.length > 0 && <span class="tab-badge dim">{c.world.runs.length}</span>}
          </button>
        ))}
        <button class="icon-btn" onClick={() => c.store.set({ navOpen: !open })} aria-label={open ? "Collapse navigator" : "Expand navigator"}>
          <Icon name={open ? "back" : "chevron"} />
        </button>
      </div>
      {open && <div class="nav-body">{tab === "atlas" ? <Atlas c={c} /> : tab === "health" ? <HealthTab c={c} /> : <Changes c={c} />}</div>}
    </aside>
  );
}
