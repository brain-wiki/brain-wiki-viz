import { useMemo, useState } from "preact/hooks";
import type { Controller } from "../controller";
import { shortTitle } from "../scene/Galaxy";
import { useStore } from "../store";
import { FLAGS, type Flag, type TopicSummary } from "../types";
import { Dot, FLAG_COLOR, FLAG_LABEL, fmt, Icon } from "./ui";

export type Sort = "size" | "health" | "recent" | "name";

/** Names as people read them: case aside, and numbers in order ("2" before "10"). */
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** What a list sorts on: a topic, or a group's topics taken together. */
interface Sortable {
  title: string;
  notes: number;
  flagged: number;
  updated: string | null;
  recent: number;
}

export function sorter(sort: Sort) {
  return (a: Sortable, b: Sortable) => {
    if (sort === "health") return b.flagged / Math.max(1, b.notes) - a.flagged / Math.max(1, a.notes) || b.flagged - a.flagged || byName(a.title, b.title);
    if (sort === "recent") return (b.updated ?? "").localeCompare(a.updated ?? "") || b.recent - a.recent || byName(a.title, b.title);
    if (sort === "size") return b.notes - a.notes || byName(a.title, b.title);
    return byName(a.title, b.title);
  };
}

function Atlas({ c }: { c: Controller }) {
  const world = c.world;
  const focus = useStore(c.store, (s) => s.focus);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("name");
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
          <option value="name">Name</option>
          <option value="size">Most notes</option>
          <option value="health">Most issues</option>
          <option value="recent">Recently changed</option>
        </select>
      </div>
      <div class="tree" role="tree">
        {world.constellations
          .map((con) => {
            const topics = nested(
              con.topics
                .map((s) => bySlug.get(s))
                .filter((t): t is TopicSummary => !!t && (!needle || t.title.toLowerCase().includes(needle) || t.slug.includes(needle))),
              sorter(sort),
            );
            const sum = (pick: (t: TopicSummary) => number) => topics.reduce((s, { topic: t }) => s + pick(t), 0);
            const updated = topics.reduce((m, { topic: t }) => ((t.updated ?? "") > m ? (t.updated ?? "") : m), "") || null;
            const group = { title: shortTitle(con.title), notes: sum((t) => t.notes), flagged: sum((t) => t.flagged), updated, recent: sum((t) => t.recent) };
            return { con, topics, group };
          })
          .sort((a, b) => sorter(sort)(a.group, b.group))
          .map(({ con, topics, group: { notes, flagged } }) => {
          if (needle && topics.length === 0) return null;
          const expanded = single || !!needle || open[con.id] || focus.constellation === con.id;
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
                  <span class="tree-meta">{con.topics.length} topics · {fmt(notes)} notes{flagged ? <span class="warn"> · {flagged}⚑</span> : null}</span>
                </button>
              )}
              {expanded && (
                <div class="tree-topics">
                  {topics.map(({ topic: t, depth }) => (
                    <button
                      key={t.slug}
                      class={`tree-topic${focus.topic === t.slug ? " active" : ""}`}
                      style={depth ? { paddingLeft: `${8 + depth * 14}px` } : undefined}
                      onClick={() => c.focus({ topic: t.slug })}
                      role="treeitem"
                      aria-level={depth + 1}
                    >
                      <Dot color={t.color} size={7} />
                      <span class="tree-title">{t.title}</span>
                      {t.flagged > 0 && <span class="badge" title={`${t.flagged} flagged notes`}>{t.flagged}</span>}
                      <span class="tree-count" title={`${fmt(t.notes)} notes`}>{fmt(t.notes)} notes</span>
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

/** Topics in tree order: each sub-topic right under its parent, siblings in the chosen order. */
export function nested(topics: TopicSummary[], order: (a: TopicSummary, b: TopicSummary) => number): { topic: TopicSummary; depth: number }[] {
  const shown = new Set(topics.map((t) => t.slug));
  const children = new Map<string, TopicSummary[]>();
  const roots: TopicSummary[] = [];
  for (const t of topics) {
    if (t.parent && shown.has(t.parent)) children.set(t.parent, [...(children.get(t.parent) ?? []), t]);
    else roots.push(t);
  }
  const out: { topic: TopicSummary; depth: number }[] = [];
  const walk = (t: TopicSummary, depth: number) => {
    out.push({ topic: t, depth });
    for (const child of (children.get(t.slug) ?? []).sort(order)) walk(child, depth + 1);
  };
  for (const t of roots.sort(order)) walk(t, 0);
  return out;
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
        <span>Highlight issues on the map: color each topic by its share of notes with issues, and ring each of those notes</span>
        <input type="checkbox" class="switch" checked={health} onChange={(e) => c.setHealth((e.target as HTMLInputElement).checked)} />
      </label>
      {flags.length === 0 && <div class="empty">No issues found.</div>}
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

/** What each kind of recorded change is called in the Activity tab. */
const RUN_KIND: Record<string, string> = {
  consolidate: "Merged captures",
  edit: "Agent edit",
  "lint-fix": "Auto-fix",
  mv: "Moved",
  undo: "Undo",
  import: "Import",
  review: "Review",
  rule: "Rule",
};

function Changes({ c }: { c: Controller }) {
  const run = useStore(c.store, (s) => s.run);
  const runs = c.world.runs;
  const titles = useMemo(() => new Map(c.world.topics.map((t) => [t.slug, t])), [c]);
  if (runs.length === 0) return <div class="empty">No activity recorded on this device yet.</div>;
  return (
    <div class="changes">
      <div class="hint">Select an entry to highlight the notes it changed.</div>
      {runs.map((r) => {
        const topics = Object.entries(r.topics).sort((a, b) => b[1] - a[1]);
        const when = r.at ? new Date(r.at) : null;
        return (
          <button key={r.id} class={`run${run?.id === r.id ? " active" : ""}`} onClick={() => c.setRun(run?.id === r.id ? null : r)}>
            <div class="run-top">
              <span class={`run-kind kind-${r.kind}`}>{RUN_KIND[r.kind] ?? r.kind}</span>
              <span class="run-when">{when ? when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
            </div>
            <div class="run-body">
              {r.episodes > 0 && <span>{r.episodes} session captures · </span>}
              <span>{r.touched.length} notes changed</span>
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
    <aside class={`panel nav${open ? "" : " collapsed"}`} aria-label="Topics, issues, and activity">
      <div class="tabs" role="tablist">
        {(["atlas", "health", "changes"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} class={`tab${tab === t ? " active" : ""}`} onClick={() => c.setNav(t)}>
            {t === "atlas" ? "Topics" : t === "health" ? "Issues" : "Activity"}
            {t === "health" && flagged > 0 && <span class="tab-badge">{fmt(flagged)}</span>}
            {t === "changes" && c.world.runs.length > 0 && <span class="tab-badge dim">{c.world.runs.length}</span>}
          </button>
        ))}
        <button class="icon-btn" onClick={() => c.store.set({ navOpen: !open })} aria-label={open ? "Collapse the panel" : "Expand the panel"} title={open ? "Collapse" : "Expand"}>
          <Icon name={open ? "back" : "chevron"} />
        </button>
      </div>
      {open && <div class="nav-body">{tab === "atlas" ? <Atlas c={c} /> : tab === "health" ? <HealthTab c={c} /> : <Changes c={c} />}</div>}
    </aside>
  );
}
