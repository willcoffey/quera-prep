import "./StateSpace.ai.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DisplayOptions } from "../../App";
import { SELECT_ANIMATION_TIME } from "../../Core";

interface StateSpaceProps {
  displayOptions: DisplayOptions;
  selectedQubits: number[];
  /** interleaved re/im amplitudes; Core mutates it in place */
  stateVector: Float64Array;
  /** changes whenever stateVector's contents do */
  version: number;
  /** measured basis state of each run, shown when showResults is on */
  results?: number[];
}

export function StateSpace({
  displayOptions,
  selectedQubits,
  stateVector,
  version,
  results,
}: StateSpaceProps) {
  const qubits = Math.round(Math.log2(stateVector.length / 2));
  const { gridLines, showResults } = displayOptions;
  const counts = useMemo(
    // The toggle decides the view; no results yet shows an empty grid
    () => (showResults ? countResults(results ?? [], 1 << qubits) : undefined),
    [showResults, results, qubits],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const empty = useEmptyColor(canvasRef);
  // stateVector is the same array after every gate, so version is the dep.
  const colors = useMemo(
    () => !empty ? [] : counts
      ? countColors(counts, empty)
      : cellColors(stateVector, empty),
    [counts, stateVector, version, empty],
  );
  const order = useMemo(
    () => (counts ? countOrder(counts) : drawOrder(stateVector)),
    [counts, stateVector, version],
  );
  const size = useDevicePixelSize(canvasRef);
  const transition = useRef<Transition>(null);
  const selectionKey = `${qubits}:${selectedQubits.join()}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size || !empty) return;
    canvas.width = size.width;
    canvas.height = size.height;

    // Retarget like a CSS transition: start from wherever cells are now,
    // so the full duration always runs from the latest selection change.
    const now = performance.now();
    const prev = transition.current;
    if (prev?.key !== selectionKey) {
      const to = layout(selectedQubits, qubits);
      // Nothing to animate from on first draw or a qubit count change.
      const animate = prev?.to.grid.size === to.grid.size;
      transition.current = {
        key: selectionKey,
        from: animate ? currentPositions(prev, now) : to.pos,
        fromLines: animate ? prev.to : to,
        to,
        start: now,
        // Core waits this long after a selection change before the next
        // gate, so the move finishes before cells start changing.
        duration: animate && !reducedMotion() ? SELECT_ANIMATION_TIME : 0,
      };
    }

    let frame = 0;
    const tick = () => {
      const t = transition.current!;
      const p = progress(t, performance.now());
      draw(ctx, size, empty.css, colors, order, t, p, gridLines);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [size, empty, colors, order, selectionKey, gridLines]);

  return (
    <div className="StateSpace">
      <canvas
        ref={canvasRef}
        className="StateSpace-canvas"
        role="img"
        aria-label={(counts
          ? `Results of ${results?.length ?? 0} runs over ${1 << qubits} basis states, `
          : `State vector of ${qubits} qubits, ${1 << qubits} amplitudes, `) +
          `grouped by ${selectedQubits.length} selected ` +
          `qubit${selectedQubits.length === 1 ? "" : "s"}`}
      />
    </div>
  );
}

interface Oklab { L: number; a: number; b: number; css: string }

/**
 * The canvas's `--empty` in OKLab, read once on mount. Cells fade into it
 * at zero brightness and it fills the background, so the gaps that open
 * between moving cells match the empty cells around them.
 */
function useEmptyColor(ref: React.RefObject<HTMLCanvasElement | null>) {
  const [empty, setEmpty] = useState<Oklab>();
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    // Let the canvas normalize any CSS color to #rrggbb
    ctx.fillStyle = getComputedStyle(ctx.canvas).getPropertyValue("--empty");
    const hex = String(ctx.fillStyle);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const { L, a, b: bb } = srgbToOklab(r, g, b);
    setEmpty({ L, a, b: bb, css: oklabToCss(L, a, bb) });
  }, [ref]);
  return empty;
}

/** Canvas size in device pixels, tracked with a ResizeObserver. */
function useDevicePixelSize(ref: React.RefObject<HTMLCanvasElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.devicePixelContentBoxSize?.[0];
      const width = box
        ? box.inlineSize
        : Math.round(entry.contentRect.width * devicePixelRatio);
      const height = box
        ? box.blockSize
        : Math.round(entry.contentRect.height * devicePixelRatio);
      setSize((s) =>
        s?.width === width && s?.height === height ? s : { width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * Grid layout for a qubit selection. Each group holds the 2^k amplitudes a
 * k-qubit gate mixes: same bits on unselected qubits, every combination on
 * selected ones. Within a group the local index follows the matrix
 * convention, first selected qubit = most significant bit (U = U₀ ⊗ U₁ …),
 * laid out row-major in a landscape block. Groups are indexed the same way
 * by unselected qubits, highest qubit = most significant, so an empty
 * selection lays out basis states in natural order.
 */
function layout(selected: number[], qubits: number) {
  // Landscape grid, square for an even qubit count.
  const grid = {
    size: 1 << qubits,
    cols: 1 << Math.ceil(qubits / 2),
    rows: 1 << Math.floor(qubits / 2),
  };
  const k = selected.length;
  const unselected = [];
  for (let q = qubits - 1; q >= 0; q--) {
    if (!selected.includes(q)) unselected.push(q);
  }
  const groupCols = 1 << Math.ceil(k / 2);
  const groupRows = 1 << Math.floor(k / 2);
  const groupsPerRow = grid.cols / groupCols;

  const bitsOf = (i: number, qubits: number[]) =>
    qubits.reduce((acc, q) => (acc << 1) | ((i >> q) & 1), 0);

  // pos[2i], pos[2i + 1] = grid row, col of basis state i
  const pos = new Float64Array(2 * grid.size);
  for (let i = 0; i < grid.size; i++) {
    const local = bitsOf(i, selected);
    const group = bitsOf(i, unselected);
    pos[2 * i] = Math.floor(group / groupsPerRow) * groupRows
      + Math.floor(local / groupCols);
    pos[2 * i + 1] = (group % groupsPerRow) * groupCols + (local % groupCols);
  }
  return { grid, pos, groupCols, groupRows, grouped: k > 0 };
}

type Layout = ReturnType<typeof layout>;

interface Transition {
  key: string; // selection the transition is heading to
  from: Float64Array; // cell positions when it started
  fromLines: Layout; // partition lines faded out
  to: Layout; // cell positions and partition lines faded in
  start: number;
  duration: number;
}

/** Eased progress, 0 → 1, CSS `ease` timing. */
function progress({ start, duration }: Transition, now: number) {
  return duration > 0 ? ease(Math.min(1, (now - start) / duration)) : 1;
}

function currentPositions(t: Transition, now: number) {
  const p = progress(t, now);
  return t.from.map((v, i) => v + (t.to.pos[i] - v) * p);
}

/** CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1). Solve x(s) = x, return y(s). */
function ease(x: number) {
  const bezier = (s: number, p1: number, p2: number) =>
    3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s ** 2 * p2 + s ** 3;
  let lo = 0, hi = 1, s = x;
  for (let i = 0; i < 20; i++) {
    s = (lo + hi) / 2;
    if (bezier(s, 0.25, 0.25) < x) lo = s;
    else hi = s;
  }
  return bezier(s, 0.1, 1);
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Brightness is probability on a log scale, so each halving dims a cell by
 * the same step: certain = full, an even spread over all 2^n worlds = 2/(n+2),
 * and anything below a quarter of that = empty. Probabilities are relative
 * to the total, since the simulator's state isn't normalized. Color shows
 * phase.
 */
function cellColors(amplitudes: Float64Array, empty: Oklab) {
  const worlds = amplitudes.length / 2;
  const range = Math.log2(worlds) + 2; // halvings from full to empty
  let total = 0;
  for (const v of amplitudes) total += v * v;
  return Array.from({ length: worlds }, (_, i) => {
    const re = amplitudes[2 * i];
    const im = amplitudes[2 * i + 1];
    const p = (re * re + im * im) / (total || 1);
    const brightness = Math.min(1, Math.max(0, 1 + Math.log2(p) / range));
    return complexColor(empty, brightness, Math.atan2(im, re));
  });
}

/** Basis states by ascending magnitude. Moving cells overlap, so drawing
 *  the largest last keeps them whole on top of near-empty ones. */
function drawOrder(amplitudes: Float64Array) {
  const mag = (i: number) => Math.hypot(amplitudes[2 * i], amplitudes[2 * i + 1]);
  return Array.from({ length: amplitudes.length / 2 }, (_, i) => i)
    .sort((a, b) => mag(a) - mag(b));
}

/** How many runs measured each basis state. */
function countResults(results: number[], worlds: number) {
  const counts = new Uint32Array(worlds);
  for (const r of results) if (r >= 0 && r < worlds) counts[r]++;
  return counts;
}

/** Measured frequency on the same log scale and lightness ramp as
 *  cellColors, without hue since runs have no phase. A result seen on every
 *  run matches a certain amplitude; one never seen matches an empty cell. */
function countColors(counts: Uint32Array, empty: Oklab) {
  const range = Math.log2(counts.length) + 2;
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return Array.from(counts, (c) => {
    const brightness = Math.min(1, Math.max(0, 1 + Math.log2(c / total) / range));
    return complexColor(empty, brightness, 0, 0);
  });
}

/** Basis states by ascending count, so common results draw on top. */
function countOrder(counts: Uint32Array) {
  return Array.from(counts, (_, i) => i).sort((a, b) => counts[a] - counts[b]);
}

function draw(
  ctx: CanvasRenderingContext2D,
  { width, height }: { width: number; height: number },
  background: string,
  colors: string[],
  order: number[],
  t: Transition,
  p: number,
  gridLines: boolean,
) {
  const css = getComputedStyle(ctx.canvas);
  // Same string as a zero brightness cell, so gaps never show
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Snap cell edges to whole device pixels so gridlines stay crisp.
  const { cols, rows } = t.to.grid;
  const x = (col: number) => Math.round(col * width / cols);
  const y = (row: number) => Math.round(row * height / rows);

  const dpr = devicePixelRatio;
  const lineWidth = (cssWidth: number) => Math.max(1, Math.round(cssWidth * dpr));
  const lines = (stepX: number, stepY: number, cssWidth: number, color: string) => {
    ctx.fillStyle = color;
    const w = lineWidth(cssWidth);
    for (let i = stepX; i < cols; i += stepX) ctx.fillRect(x(i) - (w >> 1), 0, w, height);
    for (let i = stepY; i < rows; i += stepY) ctx.fillRect(0, y(i) - (w >> 1), width, w);
  };
  for (const i of order) {
    const row = t.from[2 * i] + (t.to.pos[2 * i] - t.from[2 * i]) * p;
    const col = t.from[2 * i + 1] + (t.to.pos[2 * i + 1] - t.from[2 * i + 1]) * p;
    // Size comes from the destination cell, so it stays fixed while moving;
    // rounding both edges of a fractional position makes cells wobble.
    const toRow = t.to.pos[2 * i];
    const toCol = t.to.pos[2 * i + 1];
    const w = x(toCol + 1) - x(toCol);
    const h = y(toRow + 1) - y(toRow);
    ctx.fillStyle = colors[i];
    ctx.fillRect(Math.round(x(toCol) + (col - toCol) * width / cols),
      Math.round(y(toRow) + (row - toRow) * height / rows), w, h);
  }

  // Cell lines draw over the cells, so they stay visible on moving cells too.
  if (gridLines) lines(1, 1, 1, css.getPropertyValue("--cell-line"));

  // Partition lines cross-fade; they only mean something when groups span
  // several cells. The grid lines toggle hides them too.
  if (!gridLines) return;
  const groupLine = css.getPropertyValue("--group-line");
  for (const [l, alpha] of [[t.fromLines, 1 - p], [t.to, p]] as const) {
    if (!l.grouped || alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    lines(l.groupCols, l.groupRows, 4, groupLine);
  }
  ctx.globalAlpha = 1;
}

/**
 * Domain coloring in OKLCH, the perceptually uniform polar form of OKLab
 * (Björn Ottosson, 2020). Phase walks the hue circle at constant lightness
 * and chroma, an isoluminant cyclic map in the spirit of CET-C6/C7, so no
 * phase looks brighter than another. Brightness (0–1) blends from the
 * empty color (any tint fades out) to full lightness and chroma. Phase 0 =
 * red.
 */
function complexColor(empty: Oklab, t: number, phase: number, chroma = 0.13) {
  const L = empty.L + (0.75 - empty.L) * t;
  const C = chroma * t;
  const h = phase + (29 * Math.PI) / 180;
  return oklabToCss(
    L,
    empty.a * (1 - t) + C * Math.cos(h),
    empty.b * (1 - t) + C * Math.sin(h),
  );
}

/** 0–255 sRGB to OKLab, the inverse of oklabToCss. */
function srgbToOklab(r8: number, g8: number, b8: number) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(r8), lin(g8), lin(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToCss(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return `rgb(${gamma(r)} ${gamma(g)} ${gamma(bl)})`;
}

function gamma(x: number) {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(255 * Math.min(1, Math.max(0, v)));
}
