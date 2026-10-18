import { Fragment } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { Connection, Controller } from "../controller";
import { FAMILY_COLORS, shortTitle, type Family, type LinkEnd } from "../scene/Galaxy";
import type { Backlink, LinkTarget, NoteDetail, Rel, TopicData } from "../types";
import { linkContext, linkedText, Markdown } from "./Markdown";
import { linkPassages, propertyEntries } from "./snippets";
import { Dot, FAMILY_LABEL, fmt, Icon, LINK_SENTENCE, REL_COUNT } from "./ui";

const FAMILY_OF: Record<Rel, Family> = {
  links_to: "links",
  superseded_by: "supersedes",
  source: "cites",
  conflicts_with: "conflicts",
  depends_on: "depends",
  part_of: "parts",
};
/** The frontmatter property that holds a metadata link, by family. */
const PROPERTY: Partial<Record<Family, string>> = {
  supersedes: "bw-superseded_by",
  cites: "bw-sources",
  conflicts: "bw-conflicts_with",
  depends: "bw-depends_on",
  parts: "bw-part_of",
};
/** How the far note links back, read from the near note's backlinks. */
const BACK: Record<Backlink["relation"], string> = {
  linked_from: "also links back",
  cited_by: "also cites it",
  supersedes: "is replaced by it",
  conflicts_with: "also names the conflict",
  depended_on_by: "also depends on it",
};
const LIST_MAX = 30;

/** Fetch once per key: the value, or why it failed; neither while loading. */
function useLoad<T>(key: string, load: () => Promise<T | null>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key, data: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ key, data: null, error: null });
    load().then(
      (data) => live && setState({ key, data, error: data ? null : "Not found." }),
      (err) => live && setState({ key, data: null, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state.key === key ? state : { data: null, error: null };
}

/** The links between two topics or groups, or one link between two notes, in the Details panel. */
export function ConnectionCard({ c, t }: { c: Controller; t: Connection }) {
  return t.kind === "link" ? <LinkView c={c} t={t} /> : <FlowView c={c} t={t} />;
}

function End({ c, e, role }: { c: Controller; e: LinkEnd; role?: string }) {
  const topic = c.world.topics.find((k) => k.slug === e.topic);
  return (
    <button class="conn-end" onClick={() => c.openNote(e.id, e.topic)} title={`Open ${e.title}`}>
      <span class="conn-end-title">{e.title}</span>
      <span class="conn-end-meta">
        <Dot color={topic?.color ?? "#9cc3ff"} size={6} /> {topic?.title ?? e.topic}
        {role ? ` · ${role}` : ""}
      </span>
    </button>
  );
}

function LinkView({ c, t }: { c: Controller; t: Extract<Connection, { kind: "link" }> }) {
  const s = LINK_SENTENCE[t.family];
  const [subject, object] = s.subject === "to" ? [t.to, t.from] : [t.from, t.to];
  const { data: note, error } = useLoad<NoteDetail>(`note:${t.from.id}`, () => c.source.note(t.from.id));
  const onOpen = useCallback((x: LinkTarget) => c.openNote(x.id, x.topic), [c]);
  const links = note?.links ?? {};
  const property = PROPERTY[t.family];
  const entries = note && property ? propertyEntries(note.properties?.[property], links, t.to.id) : [];
  const passages = note?.markdown != null && t.family === "links" ? linkPassages(note.markdown, links, t.to.id) : [];
  const back = (note?.backlinks ?? []).filter((b) => b.id === t.to.id);
  const ctx = linkContext(links, onOpen);
  return (
    <>
      <div class="insp-kicker">
        <span class="swatch" style={{ background: FAMILY_COLORS[t.family] }} /> Connection · {FAMILY_LABEL[t.family]}
      </div>
      <div class="conn-ends">
        <End c={c} e={subject} role={s.roles?.[0]} />
        <div class="link-phrase conn-phrase" style={{ color: FAMILY_COLORS[t.family] }}>{s.phrase}</div>
        <End c={c} e={object} role={s.roles?.[1]} />
      </div>
      <div class="section-title">Where {t.from.title} says it</div>
      {!note && <div class="empty small">{error ?? "Reading the note…"}</div>}
      {note?.partial && <div class="hint">This exported file has the map only; serve the brain with brain viz to read the note.</div>}
      {property &&
        entries.map((v) => (
          <div class="passage passage-prop" key={v}>
            <span class="passage-key">{property}</span> {linkedText(v, ctx)}
          </div>
        ))}
      {passages.map((p) => (
        <div class="passage" key={p}>
          <Markdown text={p} links={links} onOpen={onOpen} />
        </div>
      ))}
      {note && !note.partial && entries.length === 0 && passages.length === 0 && (
        <div class="hint">The link is not in the note's text as it reads now; the map may be older than the file.</div>
      )}
      {note && (
        <button class="open-link" onClick={() => c.openNote(t.from.id, t.from.topic)}>
          <Icon name="read" /> Read the whole note <span class="row-meta">{t.from.title}</span>
        </button>
      )}
      {back.length > 0 && (
        <>
          <div class="section-title">Both ways</div>
          {back.map((b) => (
            <div class="hint" key={b.relation}>
              {t.to.title} {BACK[b.relation] ?? b.relation.replace(/_/g, " ")}.
            </div>
          ))}
        </>
      )}
    </>
  );
}

function FlowView({ c, t }: { c: Controller; t: Extract<Connection, { kind: "flow" }> }) {
  const group = t.level === "constellation";
  const name = (k: string) =>
    group ? shortTitle(c.world.constellations.find((x) => x.id === k)?.title ?? k) : (c.world.topics.find((x) => x.slug === k)?.title ?? k);
  const color = (k: string) =>
    (group ? c.world.constellations.find((x) => x.id === k)?.color : c.world.topics.find((x) => x.slug === k)?.color) ?? "#9cc3ff";
  const go = (k: string) => c.focus(group ? { constellation: k } : { topic: k });
  const rels = Object.entries(t.rels)
    .sort((x, y) => y[1] - x[1])
    .map(([rel, n]) => `${fmt(n)} ${REL_COUNT[rel as Rel] ?? rel.replace(/_/g, " ")}`);
  return (
    <>
      <div class="insp-kicker">Connection · links between {group ? "groups" : "topics"}</div>
      <div class="conn-ends">
        {[t.a, t.b].map((k, i) => (
          <Fragment key={k}>
            {i === 1 && <div class="link-phrase conn-phrase">and</div>}
            <button class="conn-end" onClick={() => go(k)} title={`Go to ${name(k)}`}>
              <span class="conn-end-title">{name(k)}</span>
              <span class="conn-end-meta">
                <Dot color={color(k)} size={6} /> {group ? "group" : "topic"}
              </span>
            </button>
          </Fragment>
        ))}
      </div>
      <div class="hint">
        {fmt(t.total)} {t.total === 1 ? "link" : "links"}
        {rels.length > 1 || !t.rels.links_to ? `: ${rels.join(" · ")}` : ""}
      </div>
      {group ? <TopicPairs c={c} t={t} /> : <NoteLinks c={c} t={t} />}
    </>
  );
}

/** The links between the notes of two topics; each opens as a connection of its own. */
function NoteLinks({ c, t }: { c: Controller; t: Extract<Connection, { kind: "flow" }> }) {
  const { data, error } = useLoad<TopicData>(`topic:${t.a}`, () => c.source.topic(t.a));
  if (!data) return <div class="empty small">{error ?? "Loading the links…"}</div>;
  const titles = new Map(data.nodes.map((n) => [n.id, n.title]));
  const rows = data.external
    .filter((e) => e.topic === t.b)
    .map((e) => {
      const near: LinkEnd = { id: e.dir === "out" ? e.source : e.target, title: "", topic: t.a };
      near.title = titles.get(near.id) ?? near.id;
      const far: LinkEnd = { id: e.dir === "out" ? e.target : e.source, title: e.title, topic: t.b };
      const [from, to] = e.dir === "out" ? [near, far] : [far, near];
      return { family: FAMILY_OF[e.rel] ?? "links", from, to };
    });
  return (
    <>
      <div class="section-title">
        Links <span class="section-count">{rows.length}</span>
      </div>
      <div class="rows">
        {rows.slice(0, LIST_MAX).map((r) => (
          <button class="row" key={`${r.family}${r.from.id}>${r.to.id}`} onClick={() => c.showConnection({ kind: "link", ...r })}>
            <span class="swatch" style={{ background: FAMILY_COLORS[r.family] }} />
            <span class="row-title">
              {r.from.title} → {r.to.title}
            </span>
          </button>
        ))}
        {rows.length > LIST_MAX && <div class="more">and {rows.length - LIST_MAX} more</div>}
        {rows.length < t.total && rows.length <= LIST_MAX && <div class="more">The map lists the first {fmt(rows.length)} of {fmt(t.total)}.</div>}
      </div>
    </>
  );
}

/** The topic pairs that make up the links between two groups; each opens as a connection. */
function TopicPairs({ c, t }: { c: Controller; t: Extract<Connection, { kind: "flow" }> }) {
  const inA = new Set(c.world.topics.filter((x) => x.constellation === t.a).map((x) => x.slug));
  const inB = new Set(c.world.topics.filter((x) => x.constellation === t.b).map((x) => x.slug));
  const title = (k: string) => c.world.topics.find((x) => x.slug === k)?.title ?? k;
  const pairs = c.world.flows.filter((f) => (inA.has(f.a) && inB.has(f.b)) || (inB.has(f.a) && inA.has(f.b))).sort((x, y) => y.total - x.total);
  return (
    <>
      <div class="section-title">
        Topic pairs <span class="section-count">{pairs.length}</span>
      </div>
      <div class="rows">
        {pairs.slice(0, LIST_MAX).map((f) => (
          <button class="row" key={`${f.a}|${f.b}`} onClick={() => c.showConnection({ kind: "flow", level: "topic", a: f.a, b: f.b, total: f.total, rels: f.rels })}>
            <span class="row-title">
              {title(f.a)} ↔ {title(f.b)}
            </span>
            <span class="row-meta">{f.total === 1 ? "1 link" : `${fmt(f.total)} links`}</span>
          </button>
        ))}
        {pairs.length > LIST_MAX && <div class="more">and {pairs.length - LIST_MAX} more</div>}
      </div>
    </>
  );
}
