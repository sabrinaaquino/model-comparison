// Model Showdown runner — same prompt, four models, via Venice /chat/completions.
// Multiple physics "events", each testing a different aspect of physics coding.
//
// Usage:
//   VENICE_KEY=... node run-showdown.mjs                    # all tasks, all models
//   VENICE_KEY=... node run-showdown.mjs --task=pendulum    # one task
//   VENICE_KEY=... node run-showdown.mjs --task=orbits --model=zai-org-glm-5-2
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.VENICE_KEY;
if (!KEY) {
  console.error("Set VENICE_KEY env var first.");
  process.exit(1);
}

const ROOT = dirname(fileURLToPath(import.meta.url));

const MODELS = [
  { id: "claude-fable-5", label: "Claude Fable 5", maxTokens: 32000 },
  { id: "openai-gpt-56-sol", label: "GPT-5.6 Sol" },
  // GLM 5.2 thinks at length; give it headroom and cap reasoning effort so
  // the answer isn't swallowed by the thinking budget.
  { id: "kimi-k3", label: "Kimi K3", maxTokens: 24000 },
  { id: "grok-4-5", label: "Grok 4.5" },
];

// Strict shared visual spec so all four models render IDENTICALLY — only the
// physics should differ between cells. Without this, each model picks its own
// colors/glow/line widths and the grid looks inconsistent.
const STYLE =
  "STRICT VISUAL SPEC — follow it exactly so different models look identical; only the physics may differ. " +
  "Solid background color #0b0b0d, repainted every frame. NO gradients, NO vignette, NO radial background fills. " +
  "NO glow and NO shadows anywhere — never set shadowBlur or shadowColor. Flat rendering only. " +
  "All static structure (walls, rods, floor, boundaries, axes): stroke #e6e6e6, lineWidth 2, no fill. " +
  "Primary moving bodies (balls, pendulum bobs) unless the task specifies otherwise: solid fill #ff8a3d, radius 12px, no outline. " +
  "Motion trails: same color as their object at 30% opacity, lineWidth 1. " +
  "On-screen text (counters/labels): color #e6e6e6, 12px monospace, top-left with 10px padding. " +
  "Do NOT draw titles, instructions, extra borders, or any background other than specified.";

const COMMON =
  "Write a single-file HTML program (all JavaScript inline, using the 2D canvas API, no external libraries). " +
  "Make the canvas fill the window and handle window resize. " +
  STYLE + " " +
  "Return ONLY the complete HTML file. No markdown code fences, no commentary.";

const TASKS = [
  {
    id: "hexagon",
    label: "Spinning hexagon",
    physics: "Collisions in a rotating reference frame",
    prompt:
      `${COMMON} The program shows a ball bouncing inside a spinning hexagon. ` +
      "The ball must be affected by gravity and friction, and it must bounce off the rotating walls realistically. " +
      "The hexagon rotates at a constant speed. The ball must never escape the hexagon.",
  },
  {
    id: "pendulum",
    label: "Double pendulum",
    physics: "Chaotic dynamics + numerical integration stability",
    prompt:
      `${COMMON} The program shows a physically accurate double pendulum (two rods, two bobs) swinging under gravity, ` +
      "using the correct equations of motion integrated with RK4. Draw the rods and bobs, and draw a fading trail showing " +
      "the path of the lower bob. No damping. The motion must look chaotic and must remain numerically stable over time " +
      "(total energy should not visibly grow).",
  },
  {
    id: "particles",
    label: "Particle fountain",
    physics: "Many-body simulation + performance",
    prompt:
      `${COMMON} The program shows a particle fountain: at least 800 particles continuously emitted from the bottom center, ` +
      "launched upward in a spread, affected by gravity and slight air drag, bouncing off the floor with energy loss and " +
      "fading out at end of life before being recycled. Particle radius 2px. Override the body color: color each particle by its " +
      "speed with this exact ramp, linearly interpolated — slow #3b82f6, medium #e6e6e6, fast #ffd23d. " +
      "It must run smoothly at 60fps; show an FPS counter at top-left per the visual spec.",
  },
  {
    id: "orbits",
    label: "Three-body orbits",
    physics: "Gravitation + energy/momentum conservation",
    prompt:
      `${COMMON} The program shows a 2D gravitational three-body simulation: three bodies of different masses attracting each ` +
      "other with Newtonian gravity, integrated with velocity Verlet (symplectic), with softening to avoid singularities. " +
      "Start from initial conditions that produce interesting non-colliding orbits for a long time. Override the body color: use " +
      "these exact colors for the three bodies — #ff8a3d, #4fd1ff, #b48ead — with radius scaled by mass (min 5px). Draw each body " +
      "with a fading orbit trail in its own color at 30% opacity. Keep the camera centered on the center of mass, and display the " +
      "total energy drift percentage at top-left per the visual spec (it should stay near 0%).",
  },
  {
    id: "cloth",
    label: "Cloth in wind",
    physics: "Soft-body constraints + integration stability",
    prompt:
      `${COMMON} The program shows a cloth simulation: a rectangular piece of cloth as a grid of at least 26x18 point masses ` +
      "connected by distance constraints, integrated with Verlet integration and several constraint-relaxation iterations per frame " +
      "for stability. Pin the top row of points so the cloth hangs and waves. Apply gravity plus a time-varying horizontal wind so it " +
      "ripples like a flag. Render the cloth as a mesh of thin #e6e6e6 lines (lineWidth 1 for the mesh is fine); draw the pinned points " +
      "as #ff8a3d dots of radius 4. The cloth must not collapse into a point, explode, or stretch unrealistically.",
  },
  {
    id: "fluid",
    label: "Fluid (water)",
    physics: "Fluid dynamics — particle SPH + stability",
    prompt:
      `${COMMON} The program shows a particle-based fluid (liquid) simulation: about 1000 small particles that behave like water using SPH ` +
      "(smoothed particle hydrodynamics) with pressure, viscosity, and gravity, so they settle into a pool and splash realistically. Use a spatial " +
      "hash grid for neighbor search so it runs smoothly at 60fps. Put the water in a rectangular container that fills most of the canvas (all four " +
      "walls visible, drawn as #e6e6e6 lines, lineWidth 2), and continuously rock the container with a slow periodic sideways gravity so the water " +
      "sloshes back and forth and splashes off the walls. Override the body color: render each particle as a filled circle of radius 3 (discrete " +
      "particles, like a particle system — NOT a smooth field), colored by speed with this exact ramp, linearly interpolated: slow #3b82f6, medium " +
      "#4fd1ff, fast #eaf6ff. Even still water must be clearly visible against the dark background. Keep it stable: particles must stay inside the " +
      "container and must never explode or NaN.",
  },
  {
    id: "throwing",
    label: "Throwing objects",
    physics: "Projectiles + collisions + stacking",
    prompt:
      `${COMMON} The program shows objects being thrown: a launcher near the bottom-left repeatedly throws round objects into the scene at ` +
      "varying angles and speeds. Each object follows projectile motion under gravity, bounces off the floor and side walls with some energy loss, " +
      "and collides with the other objects so they pile up. Keep about 120 objects active at once (recycle the oldest as new ones are thrown). " +
      "Override the default size: render each object as a filled circle of radius 7 in #ff8a3d. Draw the floor and walls as #e6e6e6 lines, " +
      "lineWidth 2. Keep it stable — objects must never tunnel through the floor, jitter wildly, or explode.",
  },
  {
    id: "ship",
    label: "Ship on waves",
    physics: "Buoyancy + wave motion",
    prompt:
      `${COMMON} The program shows a ship floating on a wavy ocean, with EVERYTHING drawn as particles (filled circles, no smooth fills). ` +
      "The ocean is a field of about 600 particles forming rolling waves that travel across the screen (sum of a few moving sine waves), colored " +
      "by height with this ramp: trough #1e3a8a, mid #4fd1ff, crest #eaf6ff. The ship — draw its hull and a mast as a compact cluster of #ff8a3d " +
      "particles — floats on the surface with buoyancy: it rides up and down and pitches/tilts to follow the wave height and slope directly beneath " +
      "it, rocking like a real boat. Dark background. Keep it stable — the ship stays on the water surface and never sinks away or flies off.",
  },
  {
    id: "donut",
    label: "Donut",
    physics: "3D rendering — rotating torus + shading",
    prompt:
      `${COMMON} The program shows the classic spinning 3D donut (torus) rendered as ASCII characters — an homage to Andy Sloane's donut.c. ` +
      "Compute the torus surface in 3D, rotate it continuously about two axes, apply simple Lambert shading from a fixed light source, and map each " +
      "surface point's brightness to the ASCII luminance ramp \".,-~:;=!*#$@\" using a z-buffer so nearer points win. This is an ASCII render, so " +
      "ignore the ball/line rules above: draw the characters in a monospace font, color #e6e6e6 on the #0b0b0d background (no other colors), " +
      "centered and filling a good portion of the canvas. Keep it smooth at 60fps.",
  },
];

function extractHtml(text) {
  let t = text.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const start = t.search(/<!DOCTYPE|<html/i);
  const end = t.lastIndexOf("</html>");
  if (start !== -1 && end !== -1) t = t.slice(start, end + "</html>".length);
  return t.trim();
}

async function runCell(task, model) {
  const outDir = join(ROOT, "out", task.id);
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.TIMEOUT_MS) || 12 * 60 * 1000);
  const url = "https://api.venice.ai/api/v1/chat/completions";
  const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  const baseBody = {
    model: model.id,
    messages: [{ role: "user", content: task.prompt }],
    temperature: 0.6,
    seed: 42,
    max_completion_tokens: model.maxTokens ?? 16000,
    ...((effortOverride || model.reasoningEffort) ? { reasoning_effort: effortOverride || model.reasoningEffort } : {}),
    venice_parameters: { strip_thinking_response: true, include_venice_system_prompt: false },
  };

  try {
    // Primary path: stream so long generations keep the socket alive (a plain
    // non-streaming request over ~5 min gets its connection cut = "fetch failed").
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ ...baseBody, stream: true, stream_options: { include_usage: true } }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    let raw = "", usage = {}, buffer = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) raw += delta;
          if (j.usage) usage = j.usage;
        } catch { /* ignore keep-alive / partial lines */ }
      }
    }
    let html = extractHtml(raw);
    let via = "stream";

    // Fallback: some models/prompts don't deliver content over the stream when
    // thinking is stripped (heavy reasoning). A non-streaming call returns the
    // whole message in one shot.
    if (!/<html/i.test(html)) {
      const res2 = await fetch(url, { method: "POST", signal: controller.signal, headers, body: JSON.stringify({ ...baseBody, stream: false }) });
      if (!res2.ok) {
        const body = await res2.text();
        throw new Error(`HTTP ${res2.status} (non-stream): ${body.slice(0, 500)}`);
      }
      const j2 = await res2.json();
      raw = j2.choices?.[0]?.message?.content ?? "";
      usage = j2.usage ?? usage;
      html = extractHtml(raw);
      via = "non-stream";
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!/<html/i.test(html)) throw new Error(`No <html> found in output (${raw.length} chars) after ${secs}s`);
    await writeFile(join(outDir, `${model.id}.html`), html, "utf8");
    console.log(
      `[ok]   ${task.id.padEnd(10)} ${model.label.padEnd(16)} ${secs}s  out=${usage.completion_tokens ?? "?"}  (${via})`
    );
    return { ok: true };
  } catch (err) {
    console.log(`[FAIL] ${task.id.padEnd(10)} ${model.label.padEnd(16)} ${err.message}`);
    await writeFile(
      join(outDir, `${model.id}.html`),
      `<!DOCTYPE html><html><body style="background:#111;color:#eee;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh"><div><h3>${model.label}: request failed</h3><pre style="white-space:pre-wrap;max-width:80ch">${String(err.message).replace(/</g, "&lt;")}</pre></div></body></html>`,
      "utf8"
    );
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

const args = process.argv.slice(2);
const taskFilter = args.find((a) => a.startsWith("--task="))?.slice(7);
const modelFilter = args.find((a) => a.startsWith("--model="))?.slice(8);
const effortOverride = args.find((a) => a.startsWith("--effort="))?.slice(9);
const modelIds = modelFilter ? modelFilter.split(",").map((s) => s.trim()) : null;
const tasks = taskFilter ? TASKS.filter((t) => t.id === taskFilter) : TASKS;
const models = modelIds ? MODELS.filter((m) => modelIds.includes(m.id)) : MODELS;
if (!tasks.length || !models.length) {
  console.error("No matching task/model. Tasks:", TASKS.map((t) => t.id).join(", "));
  process.exit(1);
}

for (const t of tasks) await mkdir(join(ROOT, "out", t.id), { recursive: true });

// All cells in parallel — each is an independent API call.
const jobs = tasks.flatMap((t) => models.map((m) => runCell(t, m)));
const results = await Promise.all(jobs);
const okCount = results.filter((r) => r.ok).length;
console.log(`\nDone. ${okCount}/${results.length} cells succeeded.`);
