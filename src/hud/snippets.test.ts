import { describe, expect, it } from "vitest";
import type { LinkTarget } from "../types";
import { propertyEntries } from "./snippets";

const links: Record<string, LinkTarget> = {
  "sync-engine": { id: "N1", title: "Sync engine", topic: "lumen" },
  "Conflict rules": { id: "N2", title: "Conflict rules", topic: "lumen" },
};

describe("propertyEntries", () => {
  it("finds the entries of a property that point to the note", () => {
    expect(propertyEntries(["[[sync-engine]]", "https://example.org"], links, "N1")).toEqual(["[[sync-engine]]"]);
    expect(propertyEntries("[[Conflict rules]]", links, "N2")).toEqual(["[[Conflict rules]]"]);
    expect(propertyEntries(undefined, links, "N2")).toEqual([]);
  });
});
