import type { VNode } from "preact";
import { describe, expect, it } from "vitest";
import { linkContext, linkedText, renderMarkdown } from "./Markdown";

type Node = VNode<Record<string, unknown>> | string | number | null | undefined | boolean | Node[];

/** Flatten an element tree into (tag, props, text) records for assertions. */
function walk(node: Node, out: { tag: string; props: Record<string, unknown>; text: string }[] = []) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (node && typeof node === "object" && "type" in node) {
    const tag = typeof node.type === "string" ? node.type : "component";
    out.push({ tag, props: node.props, text: text(node.props.children as Node) });
    walk(node.props.children as Node, out);
  }
  return out;
}

function text(node: Node): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props.children as Node);
}

const links = { fts5: { id: "N1", title: "Use FTS5", topic: "search" } };
const render = (md: string) => walk(renderMarkdown(md, links, () => {}));

describe("note markdown", () => {
  it("never turns raw HTML into elements", () => {
    const els = render('<script>alert(1)</script>\n\nHi <img src=x onerror="alert(1)"> there');
    expect(els.some((e) => e.tag === "script" || e.tag === "img")).toBe(false);
    expect(els.find((e) => e.tag === "pre")?.text).toContain("<script>");
  });

  it("drops HTML and Obsidian comments", () => {
    const all = render("A claim. <!-- id:c-1; at:2026-10-01 -->\n\nShown %%hidden%% text").map((e) => e.text).join(" ");
    expect(all).not.toContain("id:c-1");
    expect(all).not.toContain("hidden");
  });

  it("links only http(s) and mailto", () => {
    const els = render("[ok](https://example.com) [bad](javascript:alert(1)) [mail](mailto:a@example.com)");
    const hrefs = els.filter((e) => e.tag === "a").map((e) => e.props.href);
    expect(hrefs).toEqual(["https://example.com", "mailto:a@example.com"]);
  });

  it("resolves wikilinks only through the server's map", () => {
    const els = render("See [[fts5]], [[fts5|the decision]] and [[secret-note]].");
    const anchors = els.filter((e) => e.tag === "a");
    expect(anchors.map((e) => e.text)).toEqual(["Use FTS5", "the decision"]);
    const unresolved = els.find((e) => e.props.class === "md-internal unresolved");
    expect(unresolved?.text).toBe("secret-note");
  });

  it("renders callouts, tasks, tags, highlights and tables", () => {
    const els = render("> [!warning] Careful\n> Body\n\n- [x] done\n- [ ] todo\n\n#search ==hot==\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(els.find((e) => e.props.class === "md-callout warning")).toBeTruthy();
    expect(els.find((e) => e.props.class === "md-callout-title")?.text).toBe("Careful");
    expect(els.filter((e) => e.tag === "input").map((e) => e.props.checked)).toEqual([true, false]);
    expect(els.find((e) => e.props.class === "md-tag")?.text).toBe("#search");
    expect(els.find((e) => e.tag === "mark")?.text).toBe("hot");
    expect(els.filter((e) => e.tag === "td").map((e) => e.text)).toEqual(["1", "2"]);
  });
});

describe("property values", () => {
  it("open relation targets and keep the qualifier and note as text", () => {
    const opened: string[] = [];
    const ctx = linkContext(links, (t) => opened.push(t.id));
    const els = walk(linkedText("[[fts5|FTS5]] (replaced) — took 800 ms, #not-a-tag", ctx) as Node);
    const anchor = els.find((e) => e.tag === "a");
    expect(anchor?.text).toBe("FTS5");
    (anchor?.props.onClick as (e: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
    expect(opened).toEqual(["N1"]);
    expect(els.some((e) => e.props.class === "md-tag")).toBe(false);
    const missing = walk(linkedText("[[elsewhere]]", ctx) as Node);
    expect(missing[0].props.class).toBe("md-internal unresolved");
  });
});
