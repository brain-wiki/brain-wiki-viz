// The keymap (visualizer.md §4): one table drives both the key handler and the shortcuts sheet,
// so what the sheet says is what the keys do. Moving follows the breadcrumb:
// Overview › group › topic › folder › note.
import type { Controller } from "./controller";
import { FAMILIES } from "./scene/Galaxy";
import type { Keys } from "./util/keys";

export type Section = "Move" | "Show" | "Find";

/** Keys pressed together, as caps: ["⌘", "↑"]. */
export type Chord = string[];

export interface Binding {
  section: Section;
  /** Alternatives, any of which works: [["/"], ["⌘", "K"]]. */
  keys: Chord[];
  /** How alternatives read on the sheet: "or" (either works) or a range like "1–6". */
  join?: "or" | "pair" | "range";
  does: string;
  /** Whether a key press triggers it; absent for keys the browser handles itself. */
  match?: (e: KeyboardEvent) => boolean;
  run?: (c: Controller, e: KeyboardEvent) => void;
  /** Whether it also works while typing in a field. */
  whileTyping?: boolean | ((e: KeyboardEvent) => boolean);
}

const plain = (e: KeyboardEvent) => !e.altKey && !e.metaKey && !e.ctrlKey;
const letter = (ch: string) => (e: KeyboardEvent) => plain(e) && e.key.toLowerCase() === ch;

export function keymap(k: Keys): Binding[] {
  return [
    {
      section: "Move",
      keys: [[k.mod, "↑"], [k.mod, "↓"]],
      join: "pair",
      does: "Up or down one level: note, folder, topic, group, overview",
      match: (e) => (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown"),
      run: (c, e) => void (e.key === "ArrowUp" ? c.levelUp() : c.levelDown()),
    },
    {
      section: "Move",
      keys: [["["], ["]"]],
      join: "pair",
      does: "Previous or next place at the same level",
      match: (e) => plain(e) && (e.key === "[" || e.key === "]"),
      run: (c, e) => void c.sibling(e.key === "]" ? 1 : -1),
    },
    {
      section: "Move",
      keys: [["O"]],
      does: "Overview",
      match: letter("o"),
      run: (c) => c.focus({}),
    },
    {
      section: "Move",
      keys: [[k.history, "←"], [k.history, "→"]],
      join: "pair",
      does: "Back or forward through what you opened",
    },
    {
      section: "Move",
      keys: [["Esc"]],
      does: "Close what is open; otherwise up one level",
      match: (e) => e.key === "Escape",
      run: (c) => c.up(),
      whileTyping: true,
    },
    {
      section: "Show",
      keys: [["P"]],
      does: "Preview of the selected note",
      match: letter("p"),
      run: (c) => c.store.state.focus.note && c.store.set({ previewOpen: !c.store.state.previewOpen }),
    },
    {
      section: "Show",
      keys: [["I"]],
      does: "Highlight issues",
      match: letter("i"),
      run: (c) => c.setHealth(!c.store.state.health),
    },
    {
      section: "Show",
      keys: [["L"]],
      does: "Labels",
      match: letter("l"),
      run: (c) => c.setLabels(!c.store.state.labels),
    },
    {
      section: "Show",
      keys: [["1"], [String(FAMILIES.length)]],
      join: "range",
      does: "Show or hide a kind of line, in the order of the bar below",
      match: (e) => plain(e) && /^[1-9]$/.test(e.key) && Number(e.key) <= FAMILIES.length,
      run: (c, e) => {
        const family = FAMILIES[Number(e.key) - 1];
        c.setLayer(family, !c.store.state.layers[family]);
      },
    },
    {
      section: "Find",
      keys: [["/"], [k.mod, "K"]],
      join: "or",
      does: "Search notes and topics",
      match: (e) => (e.key === "/" && plain(e)) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey),
      run: (c) => c.store.set({ paletteOpen: true }),
      whileTyping: (e) => e.metaKey || e.ctrlKey,
    },
    {
      section: "Find",
      keys: [["?"]],
      does: "These shortcuts",
      match: (e) => e.key === "?" && !e.metaKey && !e.ctrlKey,
      run: (c) => c.store.set({ helpOpen: true }),
    },
  ];
}

/** The binding a key press triggers, if any. Typing in a field only lets `whileTyping` keys through. */
export function bindingFor(map: Binding[], e: KeyboardEvent, typing: boolean): Binding | undefined {
  return map.find((b) => {
    if (!b.match?.(e)) return false;
    if (!typing) return true;
    return typeof b.whileTyping === "function" ? b.whileTyping(e) : !!b.whileTyping;
  });
}
