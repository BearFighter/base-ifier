/**
 * Dev-only performance run. Open http://localhost:5173/?autotest=1 in any
 * browser: the app loads the bundled 150 x 100 scene, places a Kings of War
 * troop frame, fills it with 25 mm bases, Base-ifies, steps through the
 * preview and switches views, while recording main-thread stalls (a
 * setTimeout heartbeat, plus the Long Tasks API where the browser has it),
 * frame gaps, WebGL render times (see DevHooks in the viewport), heap size
 * and, in Chromium, a sampled CPU profile per phase. The result is POSTed to
 * the dev server (perf-log plugin in vite.config.ts), which writes it under
 * perf-logs/, and is shown at the bottom of the page.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Phase {
  label: string;
  ms: number;
  /** main-thread blocks > 50 ms seen by the heartbeat, in ms, in order */
  blocks: number[];
  blockTotalMs: number;
  /** Long Tasks API (Chromium only) */
  longTasks: number[];
  rafFrames: number;
  worstFrameGapsMs: number[];
  /** WebGL render calls in this phase: count, total ms, worst ms, triangles in the worst */
  gl: { calls: number; totalMs: number; worstMs: number; worstTris: number };
  heapMB: number | null;
  extra?: Record<string, unknown>;
  hot?: string[];
}

function post(body: unknown): Promise<string> {
  return fetch('/__perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 1) })
    .then((r) => r.json())
    .then((j) => String(j.file))
    .catch((e) => 'not saved: ' + String(e));
}
function ping(stage: string, detail?: unknown) {
  void post({ ping: stage, detail: detail === undefined ? null : String(detail), ua: navigator.userAgent, hidden: document.hidden, when: new Date().toISOString() });
}
window.addEventListener('error', (e) => ping('error', e.message));
window.addEventListener('unhandledrejection', (e) => ping('rejection', (e as PromiseRejectionEvent).reason));

// --- collectors -------------------------------------------------------------
let longTasks: number[] = [];
try {
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push(Math.round(e.duration));
  });
  po.observe({ entryTypes: ['longtask'] });
} catch {
  /* Firefox/Safari: no Long Tasks API; the heartbeat below covers it */
}

let blocks: { t: number; ms: number }[] = [];
let hbLast = performance.now();
const heartbeat = () => {
  const now = performance.now();
  const gap = now - hbLast;
  if (gap > 50) blocks.push({ t: hbLast, ms: Math.round(gap) });
  hbLast = now;
  setTimeout(heartbeat, 0);
};
setTimeout(heartbeat, 0);

let rafGaps: number[] = [];
let rafLast = performance.now();
const rafLoop = () => {
  const now = performance.now();
  rafGaps.push(now - rafLast);
  rafLast = now;
  requestAnimationFrame(rafLoop);
};
requestAnimationFrame(rafLoop);

function heapMB(): number | null {
  const m = (performance as any).memory;
  return m ? Math.round(m.usedJSHeapSize / 1e6) : null;
}
function renderTimes(): { t: number; ms: number; tris: number }[] {
  const w = window as any;
  const arr = w.__renderTimes ?? [];
  w.__renderTimes = [];
  return arr;
}
function store(): any {
  return (window as any).__appStore;
}
function setSelect(sel: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
function clickDock(re: RegExp) {
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>('.layout-dock button')).find((x) => re.test(x.textContent?.trim() ?? ''));
  if (!b) throw new Error('no dock button ' + re);
  b.click();
}
async function untilIdle(timeoutMs = 60000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (store().getState().busy === 0) return;
    await wait(50);
  }
}
async function untilLoaded(timeoutMs = 180000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const s = store().getState();
    const ids = Object.keys(s.project.sources);
    if (ids.length > 0 && s.sources[ids[0]]?.status === 'ready' && s.busy === 0) {
      const rootId = s.project.sources[ids[0]].rootPieceId;
      if (s.geometry[rootId]?.status === 'ready') return;
    }
    await wait(100);
  }
  throw new Error('scene did not load in time');
}

async function run() {
  ping('started');
  while (!store() || !Array.from(document.querySelectorAll('button')).some((b) => /150mm 100mm/.test(b.textContent ?? ''))) await wait(200);
  ping('app ready');

  let profiler: any = null;
  try {
    profiler = new (window as any).Profiler({ sampleInterval: 5, maxBufferSize: 400000 });
  } catch {
    /* not Chromium, or header missing */
  }

  const phases: Phase[] = [];
  const marks: { label: string; t0: number; t1: number }[] = [];
  let phaseStart = performance.now();
  const begin = () => {
    longTasks = [];
    blocks = [];
    rafGaps = [];
    renderTimes();
    phaseStart = performance.now();
  };
  const end = (label: string, extra?: Record<string, unknown>) => {
    const t1 = performance.now();
    const gaps = rafGaps.slice().sort((a, b) => b - a);
    const rt = renderTimes();
    const worst = rt.reduce((a, x) => (x.ms > a.ms ? x : a), { t: 0, ms: 0, tris: 0 });
    phases.push({
      label,
      ms: Math.round(t1 - phaseStart),
      blocks: blocks.map((b) => b.ms),
      blockTotalMs: blocks.reduce((a, b) => a + b.ms, 0),
      longTasks: longTasks.slice(),
      rafFrames: rafGaps.length,
      worstFrameGapsMs: gaps.slice(0, 5).map((x) => Math.round(x)),
      gl: { calls: rt.length, totalMs: Math.round(rt.reduce((a, x) => a + x.ms, 0)), worstMs: Math.round(worst.ms), worstTris: worst.tris },
      heapMB: heapMB(),
      extra,
    });
    marks.push({ label, t0: phaseStart, t1 });
  };
  const st = () => store().getState();

  // 1. load the bundled 150 x 100 scene
  begin();
  (Array.from(document.querySelectorAll('button')).find((b) => /150mm 100mm/.test(b.textContent ?? '')) as HTMLButtonElement).click();
  await untilLoaded();
  await wait(1000);
  const canvas = document.querySelector('canvas');
  const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null;
  const dbg = gl && (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
  const renderer = gl && dbg ? (gl as WebGLRenderingContext).getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  end('load scene', { renderer, canvas: canvas ? [canvas.width, canvas.height] : null });
  ping('scene loaded', renderer);

  // 2. place a frame and fill it (the real buttons)
  begin();
  const sels = () => Array.from(document.querySelectorAll<HTMLSelectElement>('.layout-dock select'));
  for (let i = 0; i < 50 && sels().length === 0; i++) await wait(100);
  setSelect(sels()[0], 'kow|footprint|Heavy Infantry Troop');
  await wait(150);
  clickDock(/^Place frame$/);
  await wait(400);
  const baseSel = sels().find((x) => /Individual base sizes/.test(x.title))!;
  const opt = Array.from(baseSel.options).find((o) => /^kow\|/.test(o.value) && /25 x 25/.test(o.text))!;
  setSelect(baseSel, opt.value);
  await wait(150);
  clickDock(/^Fill frame$/);
  await wait(800);
  end('place frame + fill');

  // 3. zoom the top view
  begin();
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: i % 2 ? 120 : -120, bubbles: true, cancelable: true }));
      await wait(33);
    }
  }
  await wait(300);
  end('30 wheel zooms');

  // 4. move a base ten times (what a drag commits)
  begin();
  const bases = Object.values(st().project.pieces).filter((p: any) => p.role === 'base') as any[];
  if (bases.length) {
    const b = bases[0];
    for (let i = 0; i < 10; i++) {
      st().updatePiece(b.id, { xy: [b.xy[0] + (i % 2), b.xy[1]] });
      await wait(100);
    }
  }
  await wait(300);
  end('10 base moves');

  // 5. Base-ify
  begin();
  await st().baseify();
  await untilIdle();
  await wait(1000);
  end('base-ify', { bases: st().previewIds.length });
  ping('base-ified');

  // 6. preview stepping, with worker time vs main-thread time split
  for (let i = 0; i < 5; i++) {
    begin();
    const t0 = performance.now();
    st().previewStep(1);
    const id = st().project.selectedId;
    let tReady = 0;
    for (let k = 0; k < 600; k++) {
      const g = st().geometry[id];
      if (g?.status === 'ready' && g.data?.hasSculpt && st().busy === 0) { tReady = performance.now(); break; }
      await wait(10);
    }
    await wait(900);
    const rt = renderTimes();
    const firstAfterReady = rt.find((x) => x.t >= tReady);
    // put the render times back so end() sees them
    (window as any).__renderTimes = rt;
    end('preview step ' + (i + 1), { workerMs: Math.round(tReady - t0), readyToFirstRenderMs: firstAfterReady ? Math.round(firstAfterReady.t - tReady) : null, sculptTris: st().geometry[id]?.data?.sculpt?.triCount ?? null });
  }

  // 7. views
  begin();
  st().setView({ mode: 'underside' });
  await wait(1200);
  end('underside');
  begin();
  st().setView({ mode: 'top' });
  await wait(1500);
  end('back to top');
  begin();
  st().setView({ mode: 'orbit' });
  await wait(1200);
  end('orbit again');
  begin();
  st().setView({ showSculpt: false });
  await wait(600);
  st().setView({ showSculpt: true });
  await wait(600);
  end('detail off/on');

  // 8. Base Studio: a 125 x 50 sci-fi deck, scattered, handed to the cutter, framed, filled and Base-ified
  try {
    const studio = () => (window as any).__studioStore.getState();
    begin();
    st().openStudio();
    for (let k = 0; k < 600 && !studio().preview; k++) await wait(50);
    end('studio open + first preview', { previewMs: studio().preview?.ms ?? null });
    begin();
    studio().update((d: any) => { d.name = 'Autotest deck'; d.board.shape = { kind: 'rect', w: 125, d: 50 }; d.board.margin = 1.5; d.ground.presetId = 'scifi-deck'; d.ground.seed = 42; d.scatterSeed = 7; });
    for (let k = 0; k < 600 && (studio().previewing || studio().dirty); k++) await wait(50);
    end('studio preset change', { previewMs: studio().preview?.ms ?? null });
    begin();
    const tScatter = performance.now();
    await studio().scatter(true);
    const scatterMs = Math.round(performance.now() - tScatter);
    for (let k = 0; k < 600 && (studio().previewing || studio().dirty); k++) await wait(50);
    end('studio scatter', { scatterMs, props: studio().doc?.props.length ?? 0, previewMs: studio().preview?.ms ?? null });
    begin();
    const tBake = performance.now();
    const srcId = await studio().useScene();
    const bakeMs = Math.round(performance.now() - tBake);
    await untilIdle();
    for (let k = 0; k < 600 && st().geometry[st().project.sources[srcId]?.rootPieceId]?.status !== 'ready'; k++) await wait(50);
    await wait(500);
    end('studio use scene', { bakeMs, sourceId: srcId, tris: st().project.sources[srcId]?.stats.tris ?? null, surface: st().view.surface });
    begin();
    for (let i = 0; i < 50 && sels().length === 0; i++) await wait(100);
    setSelect(sels()[0], 'kow|footprint|Heavy Infantry Troop');
    await wait(150);
    clickDock(/^Place frame$/);
    await wait(400);
    const bSel = sels().find((x) => /Individual base sizes/.test(x.title))!;
    const o25 = Array.from(bSel.options).find((o) => /^kow\|/.test(o.value) && /25 x 25/.test(o.text))!;
    setSelect(bSel, o25.value);
    await wait(150);
    clickDock(/^Fill frame$/);
    await wait(800);
    await st().baseify();
    await untilIdle();
    await wait(800);
    const studioBases = Object.values(st().project.pieces).filter((p: any) => p.sourceId === srcId && p.role === 'base') as any[];
    const warn = studioBases.flatMap((p: any) => st().geometry[p.id]?.data?.warnings ?? []);
    end('studio frame + fill + base-ify', { bases: studioBases.length, previewBases: st().previewIds.length, warnings: warn.slice(0, 5) });
    ping('studio done', studioBases.length);
  } catch (e) {
    ping('studio failed', e);
    end('studio failed', { error: String(e) });
  }

  // profile aggregation per phase (Chromium)
  if (profiler) {
    try {
      const trace = await profiler.stop();
      const name = (frameId: number) => {
        const fr = trace.frames[frameId];
        const res = fr.resourceId != null ? String(trace.resources[fr.resourceId] || '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace('/node_modules/.vite/deps/', '~') : '';
        return `${fr.name || '(anon)'} @ ${res}:${fr.line ?? ''}`;
      };
      for (const ph of phases) {
        const m = marks.find((x) => x.label === ph.label)!;
        const self = new Map<string, number>();
        let busy = 0;
        for (const s of trace.samples) {
          if (s.timestamp < m.t0 || s.timestamp > m.t1 || s.stackId == null) continue;
          busy++;
          const n = name(trace.stacks[s.stackId].frameId);
          self.set(n, (self.get(n) || 0) + 1);
        }
        ph.hot = Array.from(self.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${v * 5}ms ${k}`);
        ph.extra = { ...(ph.extra ?? {}), sampledBusyMs: busy * 5 };
      }
    } catch (e) {
      (phases[0].extra ??= {}).profilerError = String(e);
    }
  }

  const report = { ua: navigator.userAgent, when: new Date().toISOString(), cores: navigator.hardwareConcurrency, dpr: devicePixelRatio, hidden: document.hidden, phases };
  const saved = await post(report);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;max-height:45vh;overflow:auto;background:#111;color:#9f9;padding:8px;font:12px monospace;z-index:9999;max-width:60vw';
  box.textContent = `Perf run done — saved to ${saved}\n` + phases.map((p) => `${p.label}: ${p.ms} ms | blocks ${p.blocks.join('+') || 'none'} | frames ${p.rafFrames}, worst gaps ${p.worstFrameGapsMs.join('/')} | gl ${p.gl.calls} calls, worst ${p.gl.worstMs} ms`).join('\n');
  document.body.appendChild(box);
  (window as any).__perfReport = report;
}

void run();

export {};
