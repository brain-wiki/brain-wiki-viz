import type { BlockContent, DefinitionContent, Heading, List, ListItem, Paragraph, PhrasingContent, RootContent, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { ComponentChildren, JSX } from "preact";
import { useMemo } from "preact/hooks";
import type { LinkTarget } from "../types";

/**
 * Note Markdown rendered the way Obsidian's reading view shows it.
 *
 * Note text is untrusted. It is parsed into a Markdown syntax tree and turned straight into
 * Preact elements, never into an HTML string: raw HTML in a note shows as text, links open only
 * http(s) and mailto URLs, and wikilinks open only notes the server resolved for this profile.
 */
export function Markdown({ text, links, onOpen }: { text: string; links: Record<string, LinkTarget>; onOpen: (t: LinkTarget) => void }) {
  return useMemo(() => renderMarkdown(text, links, onOpen), [text, links, onOpen]);
}

/** The rendering itself, free of hooks so tests can inspect the element tree. */
export function renderMarkdown(text: string, links: Record<string, LinkTarget>, onOpen: (t: LinkTarget) => void): JSX.Element {
  const tree = fromMarkdown(stripObsidianComments(text), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const ctx = linkContext(links, onOpen);
  const notes = tree.children.filter((n): n is Extract<RootContent, { type: "footnoteDefinition" }> => n.type === "footnoteDefinition");
  return (
    <div class="md">
      {blocks(tree.children, ctx)}
      {notes.length > 0 && (
        <section class="md-footnotes">
          <hr />
          <ol>
            {notes.map((n) => (
              <li key={n.identifier} id={`fn-${n.identifier}`}>{blocks(n.children, ctx)}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export interface Ctx {
  resolve: (target: string) => LinkTarget | undefined;
  onOpen: (t: LinkTarget) => void;
}

/** Resolves link text to the notes the server resolved for this profile (exact, then any case). */
export function linkContext(links: Record<string, LinkTarget>, onOpen: (t: LinkTarget) => void): Ctx {
  const lower = new Map(Object.entries(links).map(([k, v]) => [k.toLowerCase(), v]));
  return { resolve: (target) => links[target] ?? lower.get(target.toLowerCase()), onOpen };
}

const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

/** Plain text whose wikilinks open notes, as Obsidian shows a property value: no other Markdown. */
export function linkedText(text: string, ctx: Ctx): ComponentChildren {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(WIKILINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(wikilink(m[2], m[1] === "!", ctx, at));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Obsidian `%% comments %%` never render; leave fenced code alone. */
function stripObsidianComments(text: string): string {
  return text
    .split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/m)
    .map((part, i) => (i % 2 ? part : part.replace(/%%[\s\S]*?%%/g, "")))
    .join("");
}

const CALLOUT = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/;
const CALLOUT_KIND: Record<string, string> = {
  note: "note", info: "info", todo: "info", abstract: "abstract", summary: "abstract", tldr: "abstract",
  tip: "tip", hint: "tip", important: "tip", success: "success", check: "success", done: "success",
  question: "question", help: "question", faq: "question", warning: "warning", caution: "warning", attention: "warning",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger",
  example: "example", quote: "quote", cite: "quote",
};

function blocks(nodes: (RootContent | BlockContent | DefinitionContent)[], ctx: Ctx): ComponentChildren {
  return nodes.map((n, i) => block(n, ctx, i));
}

function block(n: RootContent | BlockContent | DefinitionContent, ctx: Ctx, key: number): ComponentChildren {
  switch (n.type) {
    case "paragraph":
      return <p key={key}>{inline(n.children, ctx)}</p>;
    case "heading":
      return heading(n, ctx, key);
    case "thematicBreak":
      return <hr key={key} />;
    case "blockquote":
      return callout(n.children, ctx, key) ?? <blockquote key={key}>{blocks(n.children, ctx)}</blockquote>;
    case "list":
      return list(n, ctx, key);
    case "code":
      return (
        <pre key={key} class="md-code" data-lang={n.lang ?? undefined}>
          <code>{n.value}</code>
        </pre>
      );
    case "table":
      return table(n, ctx, key);
    case "html":
      return isComment(n.value) ? null : <pre key={key} class="md-raw">{n.value}</pre>;
    case "definition":
    case "footnoteDefinition":
    case "yaml":
      return null;
    default:
      return null;
  }
}

function heading(n: Heading, ctx: Ctx, key: number): JSX.Element {
  const Tag = `h${n.depth}` as "h1";
  return <Tag key={key}>{inline(n.children, ctx)}</Tag>;
}

function list(n: List, ctx: Ctx, key: number): JSX.Element {
  const items = n.children.map((item: ListItem, i) => (
    <li key={i} class={item.checked != null ? `task${item.checked ? " done" : ""}` : undefined}>
      {item.checked != null && <input type="checkbox" checked={item.checked} disabled />}
      {item.children.map((c, j) => (c.type === "paragraph" && !n.spread ? <span key={j}>{inline(c.children, ctx)}</span> : block(c, ctx, j)))}
    </li>
  ));
  return n.ordered ? <ol key={key} start={n.start ?? undefined}>{items}</ol> : <ul key={key}>{items}</ul>;
}

function table(n: Table, ctx: Ctx, key: number): JSX.Element {
  const [head, ...rows] = n.children;
  const align = (i: number) => (n.align?.[i] ? { textAlign: n.align[i] as "left" } : undefined);
  return (
    <div key={key} class="md-table">
      <table>
        {head && (
          <thead>
            <tr>{head.children.map((c, i) => <th key={i} style={align(i)}>{inline(c.children, ctx)}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, j) => (
            <tr key={j}>{r.children.map((c, i) => <td key={i} style={align(i)}>{inline(c.children, ctx)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `> [!type]± Title` blockquotes are Obsidian callouts; `+`/`-` make them foldable. */
function callout(children: (BlockContent | DefinitionContent)[], ctx: Ctx, key: number): JSX.Element | null {
  const first = children[0];
  if (first?.type !== "paragraph" || first.children[0]?.type !== "text") return null;
  const text = first.children[0].value;
  const newline = text.indexOf("\n");
  const m = CALLOUT.exec(newline < 0 ? text : text.slice(0, newline));
  if (!m) return null;
  const type = m[1].toLowerCase();
  const kind = CALLOUT_KIND[type] ?? "note";
  const title = m[3] || type.charAt(0).toUpperCase() + type.slice(1);
  const rest: Paragraph = {
    ...first,
    children: newline < 0 ? first.children.slice(1) : [{ type: "text", value: text.slice(newline + 1) }, ...first.children.slice(1)],
  };
  const body = [...(rest.children.length ? [rest] : []), ...children.slice(1)];
  const content = body.length > 0 && <div class="md-callout-body">{blocks(body, ctx)}</div>;
  const head = <div class="md-callout-title">{title}</div>;
  if (m[2]) {
    return (
      <details key={key} class={`md-callout ${kind}`} open={m[2] === "+"}>
        <summary>{head}</summary>
        {content}
      </details>
    );
  }
  return (
    <div key={key} class={`md-callout ${kind}`}>
      {head}
      {content}
    </div>
  );
}

function inline(nodes: PhrasingContent[], ctx: Ctx): ComponentChildren {
  return nodes.map((n, i) => phrase(n, ctx, i));
}

function phrase(n: PhrasingContent, ctx: Ctx, key: number): ComponentChildren {
  switch (n.type) {
    case "text":
      return <span key={key}>{obsidianText(n.value, ctx)}</span>;
    case "emphasis":
      return <em key={key}>{inline(n.children, ctx)}</em>;
    case "strong":
      return <strong key={key}>{inline(n.children, ctx)}</strong>;
    case "delete":
      return <del key={key}>{inline(n.children, ctx)}</del>;
    case "inlineCode":
      return <code key={key}>{n.value}</code>;
    case "break":
      return <br key={key} />;
    case "link":
      return safeHref(n.url) ? (
        <a key={key} class="md-external" href={n.url} target="_blank" rel="noopener noreferrer">{inline(n.children, ctx)}</a>
      ) : (
        <span key={key}>{inline(n.children, ctx)}</span>
      );
    case "image":
      return <span key={key} class="md-image">{n.alt || "image"}</span>;
    case "footnoteReference":
      return <sup key={key} class="md-fnref">[{n.label ?? n.identifier}]</sup>;
    case "html":
      return isComment(n.value) ? null : <span key={key} class="md-raw">{n.value}</span>;
    case "linkReference":
    case "imageReference":
      return <span key={key}>{"children" in n ? inline(n.children, ctx) : n.alt}</span>;
    default:
      return null;
  }
}

const OBSIDIAN = /(!?)\[\[([^[\]\n]+?)\]\]|==([^=\n]+?)==|(^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu;

/** Wikilinks, embeds, highlights and tags inside a plain text run. */
function obsidianText(text: string, ctx: Ctx): ComponentChildren {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(OBSIDIAN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[2] !== undefined) out.push(wikilink(m[2], m[1] === "!", ctx, at));
    else if (m[3] !== undefined) out.push(<mark key={at}>{m[3]}</mark>);
    else {
      out.push(m[4]);
      out.push(<span key={at} class="md-tag">#{m[5]}</span>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function wikilink(inner: string, embed: boolean, ctx: Ctx, key: number): JSX.Element {
  const [ref, alias] = splitOnce(inner, "|");
  const [target, sub] = splitAt(ref, /[#^]/);
  const resolved = ctx.resolve(target.trim());
  // Unaliased links show the note's title, which reads better than a file name.
  const label = alias?.trim() || (resolved ? resolved.title + (sub ? ` › ${sub.replace(/^[#^]/, "")}` : "") : ref.trim());
  const cls = `md-internal${resolved ? "" : " unresolved"}${embed ? " embed" : ""}`;
  if (!resolved) return <span key={key} class={cls} title="Not found, or not visible to this profile">{label}</span>;
  return (
    <a key={key} class={cls} href="#" onClick={(e) => { e.preventDefault(); ctx.onOpen(resolved); }}>
      {embed && <span class="md-embed-mark">↪ </span>}
      {label}
    </a>
  );
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

function splitAt(s: string, re: RegExp): [string, string | undefined] {
  const m = re.exec(s);
  return m ? [s.slice(0, m.index), s.slice(m.index)] : [s, undefined];
}

function safeHref(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

function isComment(html: string): boolean {
  return /^\s*<!--[\s\S]*-->\s*$/.test(html);
}
