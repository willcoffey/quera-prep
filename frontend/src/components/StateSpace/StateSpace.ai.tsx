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
}

export function StateSpace({
  displayOptions,
  selectedQubits,
  stateVector,
  version,
}: StateSpaceProps) {
  const qubits = Math.round(Math.log2(stateVector.length / 2));
  // stateVector is the same array after every gate, so version is the dep.
  const colors = useMemo(() => cellColors(stateVector), [stateVector, version]);
  const order = useMemo(() => drawOrder(stateVector), [stateVector, version]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useDevicePixelSize(canvasRef);
  const transition = useRef<Transition>(null);
  const selectionKey = `${qubits}:${selectedQubits.join()}`;
  const { gridLines } = displayOptions;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size) return;
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
      draw(ctx, size, colors, order, t, p, gridLines);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [size, colors, order, selectionKey, gridLines]);

  return (
    <div className="StateSpace">
      <canvas
        ref={canvasRef}
        className="StateSpace-canvas"
        role="img"
        aria-label={`State vector of ${qubits} qubits, ${1 << qubits} amplitudes, ` +
          `grouped by ${selectedQubits.length} selected ` +
          `qubit${selectedQubits.length === 1 ? "" : "s"}`}
      />
    </div>
  );
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
function cellColors(amplitudes: Float64Array) {
  const worlds = amplitudes.length / 2;
  const range = Math.log2(worlds) + 2; // halvings from full to empty
  let total = 0;
  for (const v of amplitudes) total += v * v;
  return Array.from({ length: worlds }, (_, i) => {
    const re = amplitudes[2 * i];
    const im = amplitudes[2 * i + 1];
    const p = (re * re + im * im) / (total || 1);
    const brightness = Math.min(1, Math.max(0, 1 + Math.log2(p) / range));
    return complexColor(brightness, Math.atan2(im, re));
  });
}

/** Basis states by ascending magnitude. Moving cells overlap, so drawing
 *  the largest last keeps them whole on top of near-empty ones. */
function drawOrder(amplitudes: Float64Array) {
  const mag = (i: number) => Math.hypot(amplitudes[2 * i], amplitudes[2 * i + 1]);
  return Array.from({ length: amplitudes.length / 2 }, (_, i) => i)
    .sort((a, b) => mag(a) - mag(b));
}

function draw(
  ctx: CanvasRenderingContext2D,
  { width, height }: { width: number; height: number },
  colors: string[],
  order: number[],
  t: Transition,
  p: number,
  gridLines: boolean,
) {
  const css = getComputedStyle(ctx.canvas);
  ctx.fillStyle = css.getPropertyValue("--empty");
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
  // Cell lines sit under the cells and show through the gaps between them,
  // so moving cells pass over them.
  if (gridLines) lines(1, 1, 1, css.getPropertyValue("--cell-line"));

  // Inset each cell to leave exactly the line's pixels uncovered at rest.
  const gap = gridLines ? lineWidth(1) : 0;
  const before = gap - (gap >> 1);
  for (const i of order) {
    const row = t.from[2 * i] + (t.to.pos[2 * i] - t.from[2 * i]) * p;
    const col = t.from[2 * i + 1] + (t.to.pos[2 * i + 1] - t.from[2 * i + 1]) * p;
    // Size comes from the destination cell, so it stays fixed while moving;
    // rounding both edges of a fractional position makes cells wobble.
    const toRow = t.to.pos[2 * i];
    const toCol = t.to.pos[2 * i + 1];
    const w = x(toCol + 1) - x(toCol) - gap;
    const h = y(toRow + 1) - y(toRow) - gap;
    ctx.fillStyle = colors[i];
    ctx.fillRect(Math.round(x(toCol) + (col - toCol) * width / cols) + before,
      Math.round(y(toRow) + (row - toRow) * height / rows) + before, w, h);
  }

  // Partition lines cross-fade; they only mean something when groups span
  // several cells. The grid lines toggle hides them too.
  if (!gridLines) return;
  const groupLine = css.getPropertyValue("--group-line");
  for (const [l, alpha] of [[t.fromLines, 1 - p], [t.to, p]] as const) {
    if (!l.grouped || alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    lines(l.groupCols, l.groupRows, 2, groupLine);
  }
  ctx.globalAlpha = 1;
}

/**
 * Domain coloring in OKLCH, the perceptually uniform polar form of OKLab
 * (Björn Ottosson, 2020). Phase walks the hue circle at constant lightness
 * and chroma, an isoluminant cyclic map in the spirit of CET-C6/C7, so no
 * phase looks brighter than another. Brightness (0–1) raises lightness and
 * chroma from the panel background to full color. Phase 0 = red.
 */
function complexColor(t: number, phase: number) {
  const L = 0.28 + 0.47 * t;
  const C = 0.13 * t;
  const h = phase + (29 * Math.PI) / 180;
  return oklabToCss(L, C * Math.cos(h), C * Math.sin(h));
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
