import { describe, expect, it } from "vitest";
import { Trail } from "./history";

const v = (hash: string) => ({ hash, focus: {} });

describe("trail", () => {
  it("records visits and ignores re-opening the current place", () => {
    const t = new Trail();
    t.visit(v("#/"));
    t.visit(v("#/t/a"));
    t.visit(v("#/t/a"));
    expect(t.entries.map((e) => e.hash)).toEqual(["#/", "#/t/a"]);
    expect(t.canBack).toBe(true);
    expect(t.canForward).toBe(false);
  });

  it("drops the forward entries when something new is opened after going back", () => {
    const t = new Trail();
    ["#/", "#/t/a", "#/t/b"].forEach((h) => t.visit(v(h)));
    t.moveTo(0);
    expect(t.canForward).toBe(true);
    t.visit(v("#/t/c"));
    expect(t.entries.map((e) => e.hash)).toEqual(["#/", "#/t/c"]);
    expect(t.index).toBe(1);
  });

  it("caps its length and keeps titles", () => {
    const t = new Trail();
    for (let i = 0; i < 130; i++) t.visit(v(`#/t/${i}`));
    expect(t.entries).toHaveLength(100);
    expect(t.entries[0].hash).toBe("#/t/30");
    expect(t.setTitle("#/t/129", "Last")).toBe(true);
    expect(t.current?.title).toBe("Last");
    expect(new Trail(t.state()).current?.title).toBe("Last");
  });
});
