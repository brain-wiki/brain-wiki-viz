import { useMemo, useState } from "preact/hooks";
import type { Controller } from "../controller";
import { FAMILY_COLORS, type Family } from "../scene/Galaxy";
import { useStore } from "../store";
import { FLAGS, type NodeData, type Rel, type TopicData } from "../types";
import { Chip, Dot, FLAG_COLOR, FLAG_LABEL, fmt, Icon } from "./ui";

const REL_LABEL: Record<Rel, string> = {
  part_of: "Part of",
  has_part: "Has part",
  depends_on: "Depends on",
  enables: "Enables",
  conflicts_with: "Conflicts with",
  supersedes: "Supersedes",
  superseded_by: "Superseded by",
  related_to: "Related to",
  links_to: "Links to",
};

/** `[[target|alias]]` → `alias`, `[[target]]` → `target`; the result is still rendered as text. */
/** Note text is shown as plain text, never rendered: drop wikilink brackets and emphasis markers. */
function plainLinks(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1");
}

const REL_FAMILY: Record<Rel, Family> = {
  part_of: "part_of",
  has_part: "part_of",
  depends_on: "depends_on",
  enables: "depends_on",
  conflicts_with: "conflicts_with",
  supersedes: "supersedes",
  superseded_by: "supersedes",
  related_to: "related_to",
  links_to: "links_to",
};

const INVERSE: Partial<Record<Rel, Rel>> = {
  part_of: "has_part",
  has_part: "part_of",
  depends_on: "enables",
  enables: "depends_on",
  supersedes: "superseded_by",
  superseded_by: "supersedes",
};

const ORDER: Rel[] = ["superseded_by", "supersedes", "conflicts_with", "depends_on", "enables", "part_of", "has_part", "related_to", "links_to"];

interface RelRow {
  rel: Rel;
  id: string;
  title: string;
  topic: string | null;
}

/** Relations of one note, from the topic payload (ids, so every row can fly). */
function relationsOf(note: string, data: TopicData | null): RelRow[] {
  if (!data) return [];
  const titles = new Map(data.nodes.map((n) => [n.id, n.title]));
  const rows: RelRow[] = [];
  const seen = new Set<string>();
  const add = (rel: Rel, id: string, title: string, topic: string | null) => {
    const key = `${rel}|${id}`;
    if (seen.has(key) || id === note) return;
    seen.add(key);
    rows.push({ rel, id, title, topic });
  };
  for (const l of data.links) {
    if (l.source === note) add(l.rel, l.target, titles.get(l.target) ?? l.target, data.slug);
    else if (l.target === note) add(l.rel === "conflicts_with" || l.rel === "related_to" || l.rel === "links_to" ? l.rel : INVERSE[l.rel] ?? l.rel, l.source, titles.get(l.source) ?? l.source, data.slug);
  }
  for (const e of data.external) {
    if (e.source === note) add(e.rel, e.target, e.title, e.topic);
    else if (e.target === note) add(e.rel === "conflicts_with" || e.rel === "related_to" || e.rel === "links_to" ? e.rel : INVERSE[e.rel] ?? e.rel, e.source, e.title, e.topic);
  }
  return rows.sort((a, b) => ORDER.indexOf(a.rel) - ORDER.indexOf(b.rel) || a.title.localeCompare(b.title));
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
      <span class="row-meta">{n.degree}</span>
    </button>
  );
}

function ConstellationCard({ c, id }: { c: Controller; id: string }) {
  const con = c.world.constellations.find((x) => x.id === id);
  if (!con) return null;
  const topics = c.world.topics.filter((t) => t.constellation === id).sort((a, b) => b.notes - a.notes);
  const notes = topics.reduce((s, t) => s + t.notes, 0);
  const flagged = topics.reduce((s, t) => s + t.flagged, 0);
  const recent = topics.reduce((s, t) => s + t.recent, 0);
  return (
    <>
      <div class="insp-kicker"><Dot color={con.color} /> Constellation</div>
      <h2 class="insp-title">{con.title}</h2>
      <div class="stats">
        <Stat label="topics" value={topics.length} />
        <Stat label="notes" value={notes} />
        <Stat label="recent" value={recent} />
        <Stat label="flagged" value={flagged} tone={flagged ? "warn" : undefined} />
      </div>
      <div class="section-title">Topics</div>
      <div class="rows">
        {topics.slice(0, 14).map((t) => (
          <button class="row" key={t.slug} onClick={() => c.focus({ topic: t.slug })}>
            <Dot color={t.color} size={7} />
            <span class="row-title">{t.title}</span>
            {t.flagged > 0 && <span class="badge">{t.flagged}</span>}
            <span class="row-meta">{fmt(t.notes)}</span>
          </button>
        ))}
        {topics.length > 14 && <div class="more">and {topics.length - 14} more in the Atlas</div>}
      </div>
    </>
  );
}

function TopicCard({ c, slug }: { c: Controller; slug: string }) {
  const data = useStore(c.store, (s) => s.topicData);
  const t = c.world.topics.find((x) => x.slug === slug);
  const flows = useMemo(
    () => c.world.flows.filter((f) => f.a === slug || f.b === slug).sort((a, b) => b.total - a.total).slice(0, 6),
    [c, slug],
  );
  if (!t) return null;
  const titles = new Map(c.world.topics.map((x) => [x.slug, x]));
  const busiest = data?.slug === slug ? [...data.nodes].filter((n) => n.id !== data.hub).sort((a, b) => b.degree - a.degree).slice(0, 8) : [];
  const hub = data?.slug === slug ? data.nodes.find((n) => n.id === data.hub) : undefined;
  return (
    <>
      <div class="insp-kicker"><Dot color={t.color} /> Topic</div>
      <h2 class="insp-title">{t.title}</h2>
      {t.description && <p class="insp-desc">{t.description}</p>}
      <div class="stats">
        <Stat label="notes" value={t.notes} />
        <Stat label="this week" value={t.recent} />
        <Stat label="flagged" value={t.flagged} tone={t.flagged ? "warn" : undefined} />
        <Stat label="updated" value={t.updated ? t.updated.slice(5) : "—"} />
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
      {hub && (
        <button class="hub-link" onClick={() => c.openNote(hub.id, slug)}>
          <Icon name="spark" /> Open the hub <span class="row-meta">{hub.title}</span>
        </button>
      )}
      <div class="section-title">Busiest notes</div>
      <div class="rows">
        {data?.slug !== slug && <div class="empty small">Loading…</div>}
        {busiest.map((n) => <NoteRow key={n.id} n={n} c={c} topic={slug} />)}
      </div>
      {flows.length > 0 && (
        <>
          <div class="section-title">Strongest links to other topics</div>
          <div class="rows">
            {flows.map((f) => {
              const other = titles.get(f.a === slug ? f.b : f.a);
              if (!other) return null;
              return (
                <button class="row" key={other.slug} onClick={() => c.focus({ topic: other.slug })}>
                  <Dot color={other.color} size={7} />
                  <span class="row-title">{other.title}</span>
                  <span class="row-meta">{f.total}</span>
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
  const data = useStore(c.store, (s) => s.topicData);
  const [copied, setCopied] = useState(false);
  const t = c.world.topics.find((x) => x.slug === slug);
  const node = data?.nodes.find((n) => n.id === id);
  const rels = useMemo(() => relationsOf(id, data?.slug === slug ? data : null), [id, data, slug]);
  const title = note?.title ?? node?.title ?? "…";
  const status = note?.status ?? node?.status;
  const byPath = new Map((data?.nodes ?? []).map((n) => [n.path, n]));
  const grouped = new Map<Rel, RelRow[]>();
  for (const r of rels) grouped.set(r.rel, [...(grouped.get(r.rel) ?? []), r]);
  const path = note?.path ?? node?.path;
  return (
    <>
      <div class="insp-kicker">
        <Dot color={t?.color ?? "#888"} /> <button class="link" onClick={() => c.focus({ topic: slug })}>{t?.title ?? slug}</button>
      </div>
      <h2 class="insp-title">{title}</h2>
      <div class="chips">
        {(note?.kind ?? node?.kind) && <Chip>{note?.kind ?? node?.kind}</Chip>}
        {(note?.type ?? node?.type) && <Chip>{note?.type ?? node?.type}</Chip>}
        {status && <Chip tone={status === "active" ? "ok" : "warn"}>{status}</Chip>}
        {(note?.privacy ?? node?.privacy) && (note?.privacy ?? node?.privacy) !== "default" && <Chip tone="private">{note?.privacy ?? node?.privacy}</Chip>}
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
        <div key={b} class={`banner${/conflict/i.test(b) ? " banner-red" : ""}`}>{b}</div>
      ))}
      {note?.summary && <p class="insp-desc">{plainLinks(note.summary)}</p>}
      {!note && <div class="empty small">Reading the note…</div>}
      {note?.partial && <div class="hint">This exported file has no claim text.</div>}
      {(note?.claims?.length ?? 0) > 0 && (
        <>
          <div class="section-title">Claims <span class="section-count">{note!.claims!.length}</span></div>
          <ul class="claims">
            {note!.claims!.map((cl, i) => (
              <li key={cl.id ?? i} class={`claim claim-${cl.status}${cl.taint === "true" || cl.taint === "unknown" ? " claim-unverified" : ""}`}>
                {plainLinks(cl.text)}
              </li>
            ))}
          </ul>
        </>
      )}
      {grouped.size > 0 && <div class="section-title">Relations <span class="section-count">{rels.length}</span></div>}
      {[...grouped].map(([rel, rows]) => (
        <div class="rel-group" key={rel}>
          <div class="rel-label" style={{ color: FAMILY_COLORS[REL_FAMILY[rel]] }}>{REL_LABEL[rel]}</div>
          {rows.slice(0, 12).map((r) => (
            <button class="row" key={`${rel}${r.id}`} onClick={() => c.openNote(r.id, r.topic)}>
              <span class="row-title">{r.title}</span>
              {r.topic && r.topic !== slug && <span class="row-meta">{c.world.topics.find((x) => x.slug === r.topic)?.title ?? r.topic}</span>}
            </button>
          ))}
          {rows.length > 12 && <div class="more">and {rows.length - 12} more</div>}
        </div>
      ))}
      {(note?.backlinks?.length ?? 0) > 0 && (
        <>
          <div class="section-title">Backlinks <span class="section-count">{note!.backlinks!.length}</span></div>
          <div class="rows">
            {note!.backlinks!.slice(0, 12).map((b) => {
              const target = byPath.get(b.path);
              return (
                <button class="row" key={b.path + b.relation} disabled={!target} onClick={() => target && c.openNote(target.id, slug)}>
                  <span class="row-title">{b.title}</span>
                  <span class="row-meta">{b.relation.replace("_", " ")}</span>
                </button>
              );
            })}
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
  const has = focus.note || focus.topic || focus.constellation;
  return (
    <aside class={`panel insp${has ? " open" : ""}`} aria-label="Inspector" aria-hidden={!has}>
      {has && (
        <button class="icon-btn insp-close" onClick={() => c.up()} aria-label="Up one level">
          <Icon name="close" />
        </button>
      )}
      <div class="insp-body">
        {focus.note && focus.topic ? (
          <NoteCard c={c} id={focus.note} slug={focus.topic} />
        ) : focus.topic ? (
          <TopicCard c={c} slug={focus.topic} />
        ) : focus.constellation && c.world.constellations.length > 1 ? (
          <ConstellationCard c={c} id={focus.constellation} />
        ) : null}
      </div>
    </aside>
  );
}
