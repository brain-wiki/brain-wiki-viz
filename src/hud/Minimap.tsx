import { useEffect, useMemo, useRef } from "preact/hooks";
import type { Controller } from "../controller";
import { healthSeverity } from "../lod";
import { useStore } from "../store";

const SIZE = 184;

/** The health ramp of the glow shader (cool → amber → red), as CSS. */
function healthColor(s: number): string {
  const stops = [[77, 107, 168], [255, 158, 41], [255, 26, 46]];
  const [a, b, t] = s < 0.5 ? [stops[0], stops[1], s * 2] : [stops[1], stops[2], (s - 0.5) * 2];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

/** Top-down galaxy with the current view; click to fly to the nearest topic. */
export function Minimap({ c }: { c: Controller }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const focus = useStore(c.store, (s) => s.focus);
  const health = useStore(c.store, (s) => s.health);
  const severity = useMemo(() => healthSeverity(c.world.topics), [c]);

  useEffect(() => {
    const canvas = ref.current;
    const g = c.galaxy;
    if (!canvas || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext("2d")!;
    const L = g.layout;
    const s = (SIZE / 2 - 10) / L.radius;
    const toMap = (x: number, z: number) => [SIZE / 2 + x * s, SIZE / 2 + z * s] as const;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      for (const con of c.world.constellations) {
        const p = L.constellations.get(con.id)!;
        const [x, y] = toMap(p.x, p.z);
        const r = Math.max(4, p.r * s);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        const haze = health ? "#8a94b0" : con.color;
        grad.addColorStop(0, `${haze}${health ? "30" : "55"}`);
        grad.addColorStop(1, `${haze}00`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (focus.constellation === con.id && !focus.topic) {
          ctx.strokeStyle = "rgba(220,230,255,0.7)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      c.world.topics.forEach((t, i) => {
        const p = L.topics.get(t.slug)!;
        const [x, y] = toMap(p.x, p.z);
        ctx.fillStyle = health ? healthColor(severity[i]) : t.color;
        ctx.globalAlpha = focus.topic && focus.topic !== t.slug ? 0.45 : 0.9;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, Math.min(3.2, p.r * s * 0.6)), 0, Math.PI * 2);
        ctx.fill();
        if (focus.topic === t.slug) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
      const ib = L.inbox;
      const [ix, iy] = toMap(ib.x, ib.z);
      ctx.fillStyle = "#ffd88a";
      ctx.beginPath();
      ctx.arc(ix, iy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // The camera: a cone from its position toward what it looks at.
      const v = g.view();
      const [cx, cy] = toMap(v.pos.x, v.pos.z);
      const [tx, ty] = toMap(v.target.x, v.target.z);
      const ang = Math.atan2(ty - cy, tx - cx);
      const len = Math.min(70, Math.max(16, Math.hypot(tx - cx, ty - cy)));
      const spread = 0.42;
      const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      grad.addColorStop(0, "rgba(140,180,255,0.42)");
      grad.addColorStop(1, "rgba(140,180,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang - spread) * len, cy + Math.sin(ang - spread) * len);
      ctx.lineTo(cx + Math.cos(ang + spread) * len, cy + Math.sin(ang + spread) * len);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#cfe0ff";
      ctx.beginPath();
      ctx.arc(Math.max(4, Math.min(SIZE - 4, cx)), Math.max(4, Math.min(SIZE - 4, cy)), 2.6, 0, Math.PI * 2);
      ctx.fill();
    };
    draw();
    const id = window.setInterval(draw, 200);
    return () => window.clearInterval(id);
  }, [c.galaxy, focus, health]);

  const onClick = (e: MouseEvent) => {
    const g = c.galaxy;
    const canvas = ref.current;
    if (!g || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const s = (SIZE / 2 - 10) / g.layout.radius;
    const wx = (e.clientX - r.left - SIZE / 2) / s;
    const wz = (e.clientY - r.top - SIZE / 2) / s;
    let best: string | null = null;
    let bestD = Infinity;
    for (const t of c.world.topics) {
      const p = g.layout.topics.get(t.slug)!;
      const d = Math.hypot(p.x - wx, p.z - wz) / p.r;
      if (d < bestD) {
        bestD = d;
        best = t.slug;
      }
    }
    if (best) c.focus({ topic: best });
  };

  return (
    <div class="panel minimap" aria-label="Minimap">
      <canvas ref={ref} style={{ width: `${SIZE}px`, height: `${SIZE}px` }} onClick={onClick} />
      <div class="minimap-label">MAP</div>
    </div>
  );
}
