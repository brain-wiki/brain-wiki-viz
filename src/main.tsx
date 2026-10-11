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
    loading.textContent = `Could not load the brain: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void start();
