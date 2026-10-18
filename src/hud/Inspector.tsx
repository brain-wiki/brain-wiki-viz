import { useMemo, useState } from "preact/hooks";
import type { Controller } from "../controller";
import { FAMILY_COLORS, LINK_COLOR, type Family } from "../scene/Galaxy";
import { type Branch, folderTree } from "../layout";
import { useStore } from "../store";
import { ConnectionCard } from "./Connection";
import { FLAGS, type Backlink, type NodeData, type NoteDetail, type Outlink, type Rel, type TopicData } from "../types";
import { Chip, Dot, FLAG_COLOR, FLAG_LABEL, fmt, Icon } from "./ui";

/** How each link reads from the note that holds it, in display order. */
const OUT_LABEL: Record<Outlink["relation"], string> = {
  superseded_by: "Replaced by",
  conflicts_with: "Conflicts with",
  depends_on: "Depends on",
  part_of: "Part of",
  links_to: "Links to",
  cites: "Cites",
};

/** How each link reads from the note it points to: this note supersedes or conflicts with that one, or that one depends on, links to, or cites this. */
const IN_LABEL: Record<Backlink["relation"], string> = {
  supersedes: "replaced by this",
  conflicts_with: "conflicts with this",
  depended_on_by: "depends on this",
  linked_from: "links here",
  cited_by: "cites this",
};

/** The drawn kind of each link, which gives its colour; body wikilinks have none. */
const OUT_FAMILY: Record<Outlink["relation"], Family | null> = {
  superseded_by: "supersedes",
  conflicts_with: "conflicts",
  depends_on: "depends",
  part_of: "parts",
  links_to: null,
  cites: "cites",
};
const IN_FAMILY: Record<Backlink["relation"], Family | null> = {
  supersedes: "supersedes",
  conflicts_with: "conflicts",
  depended_on_by: "depends",
  linked_from: null,
  cited_by: "cites",
};
const OUT_NAME: Record<Rel, Outlink["relation"]> = {
  superseded_by: "superseded_by",
  conflicts_with: "conflicts_with",
  depends_on: "depends_on",
  part_of: "part_of",
  links_to: "links_to",
  source: "cites",
};
/** Incoming `part_of` links are listed as parts, not as backlinks. */
const IN_NAME: Record<Exclude<Rel, "part_of">, Backlink["relation"]> = {
  superseded_by: "supersedes",
  conflicts_with: "conflicts_with",
  depends_on: "depended_on_by",
  links_to: "linked_from",
  source: "cited_by",
};
const colorOf = (family: Family | null | undefined) => (family ? FAMILY_COLORS[family] : LINK_COLOR);
const byTitle = (a: LinkRow, b: LinkRow) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

/** Note text is shown as plain text, never rendered: drop wikilink brackets and emphasis markers. */
function plainLinks(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1");
}

interface LinkRow {
  relation: string;
  color: string;
  label: string;
  /** null for a link that names no note. */
  id: string | null;
  title: string;
  topic: string | null;
}

/** Topic of each note the topic payload knows: its own notes and the far ends of its external links. */
function topicsOf(data: TopicData | null): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!data) return out;
  for (const n of data.nodes) out.set(n.id, data.slug);
  for (const e of data.external) out.set(e.dir === "out" ? e.target : e.source, e.topic);
  return out;
}

interface NoteLinks {
  out: LinkRow[];
  in: LinkRow[];
  /** The notes that are part of this one, by title, and how many there are in all. */
  parts: LinkRow[];
  partsTotal: number;
}

/** One note's links in both directions from the topic payload, for exported files that carry no note detail. */
function linksFromTopic(note: string, data: TopicData | null): NoteLinks {
  const rows: NoteLinks = { out: [], in: [], parts: [], partsTotal: 0 };
  if (!data) return rows;
  const titles = new Map(data.nodes.map((n) => [n.id, n.title]));
  const seen = new Set<string>();
  const add = (dir: "out" | "in", rel: Rel, id: string, title: string, topic: string | null) => {
    const key = `${dir}|${rel}|${id}`;
    if (seen.has(key) || id === note) return;
    seen.add(key);
    if (dir === "out") {
      const r = OUT_NAME[rel];
      rows.out.push({ relation: r, color: colorOf(OUT_FAMILY[r]), label: OUT_LABEL[r], id, title, topic });
    } else if (rel === "part_of") {
      rows.parts.push({ relation: "has_part", color: FAMILY_COLORS.parts, label: "Parts", id, title, topic });
    } else {
      const r = IN_NAME[rel];
      rows.in.push({ relation: r, color: colorOf(IN_FAMILY[r]), label: IN_LABEL[r], id, title, topic });
    }
  };
  for (const l of data.links) {
    if (l.source === note) add("out", l.rel, l.target, titles.get(l.target) ?? l.target, data.slug);
    else if (l.target === note) add("in", l.rel, l.source, titles.get(l.source) ?? l.source, data.slug);
  }
  for (const e of data.external) {
    if (e.source === note) add("out", e.rel, e.target, e.title, e.topic);
    else if (e.target === note) add("in", e.rel, e.source, e.title, e.topic);
  }
  rows.parts.sort(byTitle);
  rows.partsTotal = rows.parts.length;
  return rows;
}

/** The note's links as the server read them, with each target's topic so a row can fly there. */
function linksFromNote(note: NoteDetail, topics: Map<string, string | null>): NoteLinks {
  const topicOf = (id: string | null, raw?: string) => (id ? (raw ? note.links?.[raw]?.topic : undefined) ?? topics.get(id) ?? null : null);
  return {
    out: (note.outlinks ?? []).map((o) => ({
      relation: o.relation,
      color: colorOf(OUT_FAMILY[o.relation]),
      label: OUT_LABEL[o.relation] ?? o.relation,
      id: o.resolved ? o.id : null,
      title: o.title ?? o.target,
      topic: topicOf(o.resolved ? o.id : null, o.target),
    })),
    in: (note.backlinks ?? []).map((b) => ({
      relation: b.relation,
      color: colorOf(IN_FAMILY[b.relation]),
      label: IN_LABEL[b.relation] ?? b.relation.replace(/_/g, " "),
      id: b.id,
      title: b.title,
      topic: topicOf(b.id),
    })),
    parts: (note.parts ?? []).map((p) => ({ relation: "has_part", color: FAMILY_COLORS.parts, label: "Parts", id: p.id, title: p.title, topic: topicOf(p.id) })),
    partsTotal: note.parts_total ?? note.parts?.length ?? 0,
  };
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div class={`stat${tone ? ` stat-${tone}` : ""}`}>
      <div class="stat-v">{typeof value === "number" ? fmt(value) : value}</div>
      <div class="stat-l">{label}</div>
    </div>
  );
}

function NoteRow({ n, c, topic }: { n: NodeData; c: Controller; topic: string }) {
  return (
    <button class="row" onClick={() => c.openNote(n.id, topic)}>
      <span class="row-title">{n.title}</span>
      {n.flags.length > 0 && <Dot color={FLAG_COLOR[n.flags[0]]} size={6} />}
      <span class="row-meta">{n.degree === 1 ? "1 link" : `${fmt(n.degree)} links`}</span>
    </button>
  );
}

function notes(n: number): string {
  return n === 1 ? "1 note" : `${fmt(n)} notes`;
}

function ConstellationCard({ c, id }: { c: Controller; id: string }) {
  const con = c.world.constellations.find((x) => x.id === id);
  if (!con) return null;
  const topics = c.world.topics.filter((t) => t.constellation === id).sort((a, b) => b.notes - a.notes);
  const count = topics.reduce((s, t) => s + t.notes, 0);
  const flagged = topics.reduce((s, t) => s + t.flagged, 0);
  const recent = topics.reduce((s, t) => s + t.recent, 0);
  return (
    <>
      <div class="insp-kicker"><Dot color={con.color} /> Group of topics</div>
      <h2 class="insp-title">{con.title}</h2>
      <div class="stats">
        <Stat label="topics" value={topics.length} />
        <Stat label="notes" value={count} />
        <Stat label="changed 7d" value={recent} />
        <Stat label="with issues" value={flagged} tone={flagged ? "warn" : undefined} />
      </div>
      <div class="section-title">Topics</div>
      <div class="rows">
        {topics.slice(0, 14).map((t) => (
          <button class="row" key={t.slug} onClick={() => c.focus({ topic: t.slug })}>
            <Dot color={t.color} size={7} />
            <span class="row-title">{t.title}</span>
            {t.flagged > 0 && <span class="badge">{t.flagged}</span>}
            <span class="row-meta">{notes(t.notes)}</span>
          </button>
        ))}
        {topics.length > 14 && <div class="more">and {topics.length - 14} more in the Topics tab</div>}
      </div>
    </>
  );
}

function TopicCard({ c, slug }: { c: Controller; slug: string }) {
  const data = useStore(c.store, (s) => s.topicData);
  const topicError = useStore(c.store, (s) => s.topicError);
  const t = c.world.topics.find((x) => x.slug === slug);
  const flows = useMemo(
    () => c.world.flows.filter((f) => f.a === slug || f.b === slug).sort((a, b) => b.total - a.total).slice(0, 6),
    [c, slug],
  );
  if (!t) return null;
  const titles = new Map(c.world.topics.map((x) => [x.slug, x]));
  const ready = data?.slug === slug ? data : null;
  const busiest = ready ? [...ready.nodes].filter((n) => n.id !== ready.page).sort((a, b) => b.degree - a.degree).slice(0, 8) : [];
  const page = ready?.nodes.find((n) => n.id === ready.page);
  const subTopics = c.world.topics.filter((x) => x.parent === slug).sort((a, b) => b.notes - a.notes);
  const folders = ready
    ? [...folderTree(ready).branches.values()].filter((b) => b.depth === 1).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    : [];
  return (
    <>
      <div class="insp-kicker"><Dot color={t.color} /> Topic</div>
      <h2 class="insp-title">{t.title}</h2>
      {t.description && <p class="insp-desc">{t.description}</p>}
      <div class="stats">
        <Stat label="notes" value={t.notes} />
        <Stat label="changed 7d" value={t.recent} />
        <Stat label="with issues" value={t.flagged} tone={t.flagged ? "warn" : undefined} />
        <Stat label="last change" value={t.updated ? t.updated.slice(5) : "—"} />
      </div>
      {t.flagged > 0 && (
        <div class="flag-chips">
          {FLAGS.filter((f) => t.flags[f]).map((f) => (
            <span class="flag-chip" key={f} style={{ borderColor: FLAG_COLOR[f] }}>
              <Dot color={FLAG_COLOR[f]} size={6} /> {FLAG_LABEL[f]} <b>{t.flags[f]}</b>
            </span>
          ))}
        </div>
      )}
      {page && (
        <button class="open-link" onClick={() => c.openNote(page.id, slug)}>
          <Icon name="spark" /> Open the topic page <span class="row-meta">{page.title}</span>
        </button>
      )}
      {subTopics.length > 0 && (
        <>
          <div class="section-title">Sub-topics <span class="section-count">{subTopics.length}</span></div>
          <div class="rows">
            {subTopics.slice(0, 14).map((x) => (
              <button class="row" key={x.slug} onClick={() => c.focus({ topic: x.slug })}>
                <Dot color={x.color} size={7} />
                <span class="row-title">{x.title}</span>
                <span class="row-meta">{notes(x.notes)}</span>
              </button>
            ))}
            {subTopics.length > 14 && <div class="more">and {subTopics.length - 14} more in the Topics tab</div>}
          </div>
        </>
      )}
      {folders.length > 0 && (
        <>
          <div class="section-title">Folders <span class="section-count">{folders.length}</span></div>
          <div class="rows">
            {folders.slice(0, 12).map((b: Branch) => (
              <button class="row" key={b.key} disabled={!b.note} title={b.note ? undefined : "This folder has no folder note"} onClick={() => b.note && c.openNote(b.note, slug)}>
                <Icon name="folder" />
                <span class="row-title">{b.title}</span>
                <span class="row-meta">{notes(b.count)}</span>
              </button>
            ))}
            {folders.length > 12 && <div class="more">and {folders.length - 12} more</div>}
          </div>
        </>
      )}
      {!ready && <div class="empty small">{topicError ?? "Loading…"}</div>}
      {ready && ready.nodes.length > 5 && (
        <>
          <div class="section-title">Most connected</div>
          <div class="rows">{busiest.map((n) => <NoteRow key={n.id} n={n} c={c} topic={slug} />)}</div>
        </>
      )}
      {flows.length > 0 && (
        <>
          <div class="section-title">Linked topics</div>
          <div class="rows">
            {flows.map((f) => {
              const other = titles.get(f.a === slug ? f.b : f.a);
              if (!other) return null;
              return (
                <button class="row" key={other.slug} onClick={() => c.focus({ topic: other.slug })}>
                  <Dot color={other.color} size={7} />
                  <span class="row-title">{other.title}</span>
                  <span class="row-meta">{f.total === 1 ? "1 link" : `${fmt(f.total)} links`}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function NoteCard({ c, id, slug }: { c: Controller; id: string; slug: string }) {
  const note = useStore(c.store, (s) => s.note);
  const noteError = useStore(c.store, (s) => s.noteError);
  const data = useStore(c.store, (s) => s.topicData);
  const [copied, setCopied] = useState(false);
  const t = c.world.topics.find((x) => x.slug === slug);
  const node = data?.nodes.find((n) => n.id === id);
  const links = useMemo(() => {
    const ready = data?.slug === slug ? data : null;
    // An exported file has no note detail; the topic payload still knows which notes link.
    return note && !note.partial ? linksFromNote(note, topicsOf(ready)) : linksFromTopic(id, ready);
  }, [id, note, data, slug]);
  const title = note?.title ?? node?.title ?? "…";
  const status = note?.status ?? node?.status;
  const grouped = new Map<string, LinkRow[]>();
  for (const r of links.out) grouped.set(r.relation, [...(grouped.get(r.relation) ?? []), r]);
  const order = Object.keys(OUT_LABEL);
  const groups = [...grouped].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const row = (r: LinkRow, meta?: string) => (
    <button class="row" key={`${r.relation}${r.id ?? r.title}`} disabled={!r.id || !r.topic} title={!r.id ? "No note by this name" : !r.topic ? "Not in a topic on this map, such as an inbox episode" : undefined} onClick={() => r.id && c.openNote(r.id, r.topic)}>
      <span class="row-title">{r.title}</span>
      {meta && <span class="row-meta">{meta}</span>}
      {!meta && r.topic && r.topic !== slug && <span class="row-meta">{c.world.topics.find((x) => x.slug === r.topic)?.title ?? r.topic}</span>}
      {!r.id && <span class="row-meta">not found</span>}
      {r.id && !r.topic && <span class="row-meta">not on the map</span>}
    </button>
  );
  const path = note?.path ?? node?.path;
  const place = useMemo(() => {
    if (data?.slug !== slug) return [] as Branch[];
    const { branches, folderOf } = folderTree(data);
    const out: Branch[] = [];
    for (let b = branches.get(folderOf.get(id) ?? ""); b && b.key !== ""; b = b.parent === null ? undefined : branches.get(b.parent)) {
      if (b.note !== id) out.unshift(b);
    }
    return out;
  }, [data, slug, id]);
  return (
    <>
      <div class="insp-kicker">
        <Dot color={t?.color ?? "#888"} /> <button class="link" onClick={() => c.focus({ topic: slug })}>{t?.title ?? slug}</button>
      </div>
      <h2 class="insp-title">{title}</h2>
      {place.length > 0 && (
        <div class="insp-place" title="Where this note lives">
          In {[t?.title ?? slug, ...place.map((b) => b.title)].join(" › ")}
        </div>
      )}
      <div class="chips">
        {(note?.kind ?? node?.kind) && <Chip>{note?.kind ?? node?.kind}</Chip>}
        {(note?.type ?? node?.type) && <Chip>{note?.type ?? node?.type}</Chip>}
        {status && <Chip tone={status === "active" ? "ok" : "warn"}>{status}</Chip>}
        {(note?.updated ?? node?.updated) && <Chip tone="dim">updated {(note?.updated ?? node?.updated ?? "").slice(0, 10)}</Chip>}
      </div>
      {node && node.flags.length > 0 && (
        <div class="flag-chips">
          {node.flags.map((f) => (
            <span class="flag-chip" key={f} style={{ borderColor: FLAG_COLOR[f] }}>
              <Dot color={FLAG_COLOR[f]} size={6} /> {FLAG_LABEL[f]}
            </span>
          ))}
        </div>
      )}
      {(note?.banners ?? []).map((b) => (
        <div key={b} class={`banner${b.startsWith("⚠") ? "" : " banner-info"}`}>{b}</div>
      ))}
      {note?.summary && <p class="insp-desc">{plainLinks(note.summary)}</p>}
      {!note && <div class="empty small">{noteError ?? "Reading the note…"}</div>}
      {note?.partial && <div class="hint">This exported file has the map only; serve the brain with brain viz to read the note.</div>}
      {groups.length > 0 && <div class="section-title">Links <span class="section-count">{links.out.length}</span></div>}
      {groups.map(([rel, rows]) => (
        <div class="rel-group" key={rel}>
          <div class="rel-label" style={{ color: rows[0].color }}>{rows[0].label}</div>
          {rows.slice(0, 12).map((r) => row(r))}
          {rows.length > 12 && <div class="more">and {rows.length - 12} more</div>}
        </div>
      ))}
      {links.parts.length > 0 && (
        <>
          <div class="section-title" style={{ color: FAMILY_COLORS.parts }}>Parts <span class="section-count">{links.partsTotal}</span></div>
          <div class="rows">
            {links.parts.slice(0, 20).map((r) => row(r))}
            {links.partsTotal > 20 && <div class="more">and {links.partsTotal - 20} more</div>}
          </div>
        </>
      )}
      {links.in.length > 0 && (
        <>
          <div class="section-title">Linked from <span class="section-count">{links.in.length}</span></div>
          <div class="rows">
            {links.in.slice(0, 12).map((r) => row(r, r.label))}
            {links.in.length > 12 && <div class="more">and {links.in.length - 12} more</div>}
          </div>
        </>
      )}
      {path && (
        <div class="path-row">
          <code class="path">{path}</code>
          <button class="icon-btn" title="Read the note (P)" onClick={() => c.store.set({ previewOpen: true })}>
            <Icon name="read" />
          </button>
          <button
            class="icon-btn"
            title="Copy path"
            onClick={() => {
              void navigator.clipboard?.writeText(note?.abs_path ?? path);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Icon name="copy" />
          </button>
          {note?.abs_path && (
            <a class="icon-btn" title="Open in Obsidian" href={`obsidian://open?path=${encodeURIComponent(note.abs_path)}`}>
              <Icon name="open" />
            </a>
          )}
          {copied && <span class="copied">copied</span>}
        </div>
      )}
    </>
  );
}

export function Inspector({ c }: { c: Controller }) {
  const focus = useStore(c.store, (s) => s.focus);
  const connection = useStore(c.store, (s) => s.connection);
  const card = connection ? (
    <ConnectionCard c={c} t={connection} />
  ) : focus.note && focus.topic ? (
      <NoteCard c={c} id={focus.note} slug={focus.topic} />
    ) : focus.topic ? (
      <TopicCard c={c} slug={focus.topic} />
    ) : focus.constellation && c.world.constellations.length > 1 ? (
      <ConstellationCard c={c} id={focus.constellation} />
    ) : null;
  return (
    <aside class={`panel insp open${card ? "" : " idle"}`} aria-label="Details">
      <div class="insp-head">
        <span>Details</span>
        {connection ? (
          <button class="icon-btn" onClick={() => c.closeConnection()} title="Close the connection (Esc)" aria-label="Close the connection">
            <Icon name="close" />
          </button>
        ) : (
          card && (
            <button class="icon-btn" onClick={() => c.up()} title="Up one level (Esc)" aria-label="Up one level">
              <Icon name="close" />
            </button>
          )
        )}
      </div>
      <div class="insp-body">{card ?? <div class="empty small">Click a topic, a star, or a link to see its details here.</div>}</div>
    </aside>
  );
}
