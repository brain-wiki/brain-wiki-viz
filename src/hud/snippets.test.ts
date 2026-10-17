import { describe, expect, it } from "vitest";
import type { LinkTarget } from "../types";
import { linkPassages, propertyEntries } from "./snippets";

const links: Record<string, LinkTarget> = {
  "sync-engine": { id: "N1", title: "Sync engine", topic: "lumen" },
  "Conflict rules": { id: "N2", title: "Conflict rules", topic: "lumen" },
};

describe("linkPassages", () => {
  it("returns the paragraph that links, with aliases, anchors, and any case", () => {
    const md = "Intro without links.\n\nLumen merges edits with [[sync-engine|the engine]].\nIt retries.\n\n## Later\n\nSee [[SYNC-ENGINE#retries]].";
    expect(linkPassages(md, links, "N1")).toEqual(["Lumen merges edits with [[sync-engine|the engine]].\nIt retries.", "See [[SYNC-ENGINE#retries]]."]);
  });

  it("keeps only the list items and table rows that link", () => {
    const md = "- one\n- two, per [[conflict rules]]\n- three\n\n| a | b |\n|---|---|\n| x | [[sync-engine]] |";
    expect(linkPassages(md, links, "N2")).toEqual(["- two, per [[conflict rules]]"]);
    expect(linkPassages(md, links, "N1")).toEqual(["| x | [[sync-engine]] |"]);
  });

  it("keeps a list item whole when the link is on a continuation line", () => {
    const md = "- First item.\n- Second item, which goes on\n  to cite [[sync-engine]].\n- Third.";
    expect(linkPassages(md, links, "N1")).toEqual(["- Second item, which goes on\nto cite [[sync-engine]]."]);
  });

  it("skips code blocks and stops at the limit", () => {
    const md = "```\n[[sync-engine]]\n```\n\n[[sync-engine]] a\n\n[[sync-engine]] b\n\n[[sync-engine]] c";
    expect(linkPassages(md, links, "N1", 2)).toEqual(["[[sync-engine]] a", "[[sync-engine]] b"]);
  });
});

describe("propertyEntries", () => {
  it("finds the entries of a property that point to the note", () => {
    expect(propertyEntries(["[[sync-engine]]", "https://example.org"], links, "N1")).toEqual(["[[sync-engine]]"]);
    expect(propertyEntries("[[Conflict rules]]", links, "N2")).toEqual(["[[Conflict rules]]"]);
    expect(propertyEntries(undefined, links, "N2")).toEqual([]);
  });
});
