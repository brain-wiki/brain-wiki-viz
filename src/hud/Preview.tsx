import { useCallback, useMemo } from "preact/hooks";
import type { Controller } from "../controller";
import { useStore } from "../store";
import type { LinkTarget } from "../types";
import { type Ctx, linkContext, linkedText, Markdown } from "./Markdown";
import { Dot, Icon } from "./ui";

/** The selected note rendered like Obsidian's reading view: inline title, properties, body. */
export function Preview({ c }: { c: Controller }) {
  const open = useStore(c.store, (s) => s.previewOpen);
  const focus = useStore(c.store, (s) => s.focus);
  const note = useStore(c.store, (s) => s.note);
  const noteError = useStore(c.store, (s) => s.noteError);
  const onOpen = useCallback((t: LinkTarget) => c.openNote(t.id, t.topic), [c]);
  if (!open || !focus.note) return null;
  const ready = note && note.id === focus.note ? note : null;
  const topic = c.world.topics.find((t) => t.slug === (ready?.topic ?? focus.topic));
  return (
    <aside class="panel preview" role="dialog" aria-label="Note preview">
      <header class="preview-head">
        <div class="insp-kicker">
          <Dot color={topic?.color ?? "#9cc3ff"} size={7} /> {topic?.title ?? "Note"}
        </div>
        <div class="preview-actions">
          {ready?.abs_path && (
            <a class="icon-btn" title="Open in Obsidian" href={`obsidian://open?path=${encodeURIComponent(ready.abs_path)}`}>
              <Icon name="open" />
            </a>
          )}
          <button class="icon-btn" title="Close (Esc)" aria-label="Close preview" onClick={() => c.store.set({ previewOpen: false })}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div class="preview-body">
        {!ready ? (
          <div class="empty">{noteError ?? "Loading…"}</div>
        ) : (
          <>
            {/* Like Obsidian's inline title, unless the note already opens with its own H1. */}
            {!/^\s*#\s+\S/.test(ready.markdown ?? "") && <h1 class="md-inline-title">{ready.title}</h1>}
            {ready.properties && <Properties props={ready.properties} links={ready.links ?? {}} onOpen={onOpen} />}
            {ready.markdown != null ? (
              <Markdown text={ready.markdown} links={ready.links ?? {}} onOpen={onOpen} />
            ) : (
              <div class="empty">Exported maps do not include note text. Run <code>brain viz</code> to read notes.</div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

const HIDDEN = new Set(["title"]);
const CLAIMS = new Set(["bw-claims", "bw-claims-superseded"]);
const CLAIM_META = /\s*\{([^{}]*)\}\s*$/;

/**
 * Obsidian's properties table: one row per frontmatter key; lists and tags as chips. As in
 * Obsidian, wikilinks in values (relations such as `bw-part_of`) open the note they point to.
 */
function Properties({ props, links, onOpen }: { props: Record<string, unknown>; links: Record<string, LinkTarget>; onOpen: (t: LinkTarget) => void }) {
  const ctx = useMemo(() => linkContext(links, onOpen), [links, onOpen]);
  const rows = Object.entries(props).filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "");
  if (!rows.length) return null;
  return (
    <details class="md-props" open>
      <summary>Properties</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div class="md-prop" key={k}>
            <dt>{k}</dt>
            <dd>{value(k, v, ctx)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function value(key: string, v: unknown, ctx: Ctx) {
  if (Array.isArray(v)) {
    return v.map((x, i) => (
      <span key={i} class={key === "tags" ? "md-tag" : "md-chip"}>
        {key === "tags" ? `#${String(x)}` : item(key, String(x), ctx)}
      </span>
    ));
  }
  if (typeof v === "boolean") return <input type="checkbox" checked={v} disabled />;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^https?:\/\//i.test(s)) {
    return (
      <a class="md-external" href={s} target="_blank" rel="noopener noreferrer">
        {s.replace(/^https?:\/\//, "")}
      </a>
    );
  }
  return item(key, s, ctx);
}

/** One value with live wikilinks; a claim's `{id: …}` block moves to a tooltip. */
function item(key: string, s: string, ctx: Ctx) {
  const meta = CLAIMS.has(key) ? CLAIM_META.exec(s) : null;
  if (!meta) return linkedText(s, ctx);
  const text = linkedText(s.slice(0, meta.index), ctx);
  return <span title={meta[1]}>{key === "bw-claims-superseded" ? <s>{text}</s> : text}</span>;
}
