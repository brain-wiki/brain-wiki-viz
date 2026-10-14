import { render } from "preact";
import { openSource } from "./api";
import { Controller } from "./controller";
import { App } from "./hud/App";
import "./styles.css";

async function start(): Promise<void> {
  const root = document.getElementById("app")!;
  const loading = document.createElement("div");
  loading.className = "boot";
  loading.textContent = "Charting your brain…";
  root.appendChild(loading);
  try {
    const source = openSource();
    const world = await source.world();
    loading.remove();
    render(<App c={new Controller(source, world)} />, root);
  } catch (err) {
    loading.className = "boot boot-error";
    loading.textContent = bootError(err);
  }
}

/** What went wrong at start, in terms of what the user can do about it. */
function bootError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // fetch rejects with a TypeError when nothing answers at all.
  if (err instanceof TypeError) return "Could not reach brain viz. Is `brain viz` still running?";
  if (/HTTP 40[13]\b/.test(message)) return "This link's token is not valid. Open the link `brain viz` printed.";
  return `Could not load the brain: ${message}`;
}

void start();
