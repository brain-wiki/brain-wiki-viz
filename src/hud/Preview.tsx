import { useCallback } from "preact/hooks";
import type { Controller } from "../controller";
import { useStore } from "../store";
import type { LinkTarget } from "../types";
import { Markdown } from "./Markdown";
import { Dot, Icon } from "./ui";

/** The selected note rendered like Obsidian's reading view: inline title, properties, body. */
export function Preview({ c }: { c: Controller }) {
  const open = useStore(c.store, (s) => s.previewOpen);
  const focus = useStore(c.store, (s) => s.focus);
  const note = useStore(c.store, (s) => s.note);
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
          <div class="empty">Loading…</div>
        ) : (
          <>
            {/* Like Obsidian's inline title, unless the note already opens with its own H1. */}
            {!/^\s*#\s+\S/.test(ready.markdown ?? "") && <h1 class="md-inline-title">{ready.title}</h1>}
            {ready.properties && <Properties props={ready.properties} />}
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

/** Obsidian's properties table: one row per frontmatter key; lists and tags as chips. */
function Properties({ props }: { props: Record<string, unknown> }) {
  const rows = Object.entries(props).filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "");
  if (!rows.length) return null;
  return (
    <details class="md-props" open>
      <summary>Properties</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div class="md-prop" key={k}>
            <dt>{k}</dt>
            <dd>{value(k, v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function value(key: string, v: unknown) {
  if (Array.isArray(v)) {
    return v.map((x, i) => (
      <span key={i} class={key === "tags" ? "md-tag" : "md-chip"}>
        {key === "tags" ? `#${String(x)}` : String(x)}
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
  return s;
}
