import { describe, expect, it } from "vitest";
import { bindingFor, keymap } from "./keymap";
import { keys } from "./util/keys";

const press = (key: string, mods: Partial<Record<"altKey" | "metaKey" | "ctrlKey" | "shiftKey", boolean>> = {}) =>
  ({ key, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

describe("keymap", () => {
  const map = keymap(keys(false));
  const does = (e: KeyboardEvent, typing = false) => bindingFor(map, e, typing)?.does;

  it("maps each key to one action", () => {
    expect(does(press("ArrowUp", { altKey: true }))).toMatch(/^Up or down one level/);
    expect(does(press("ArrowUp"))).toBeUndefined(); // plain arrows stay with the browser
    expect(does(press("]"))).toMatch(/same level/);
    expect(does(press("]", { metaKey: true }))).toBeUndefined(); // ⌘] is the browser's forward
    expect(does(press("o"))).toBe("Overview");
    expect(does(press("i"))).toBe("Highlight issues");
    expect(does(press("3"))).toMatch(/kind of line/);
    expect(does(press("7"))).toBeUndefined(); // only as many as there are kinds of line
    expect(does(press("k", { ctrlKey: true }))).toBe("Search notes and topics");
    expect(does(press("?", { shiftKey: true }))).toBe("These shortcuts");
  });

  it("lets only Esc and Ctrl/⌘ K through while typing", () => {
    expect(does(press("Escape"), true)).toMatch(/^Close/);
    expect(does(press("k", { metaKey: true }), true)).toBe("Search notes and topics");
    expect(does(press("/"), true)).toBeUndefined();
    expect(does(press("l"), true)).toBeUndefined();
  });

  it("lists every action on the sheet, with keys spelled for the platform", () => {
    expect(map.every((b) => b.keys.length > 0 && b.does)).toBe(true);
    const mac = keymap(keys(true));
    expect(mac.find((b) => b.does.startsWith("Up or down"))!.keys).toEqual([["⌥", "↑"], ["⌥", "↓"]]);
    expect(mac.find((b) => b.does.startsWith("Back"))!.keys).toEqual([["⌘", "←"], ["⌘", "→"]]);
    expect(map.find((b) => b.does.startsWith("Back"))!.keys).toEqual([["Alt", "←"], ["Alt", "→"]]);
  });
});
