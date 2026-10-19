/**
 * Rasterizes the state space grid into an RGBA buffer. No DOM, so it runs in
 * plain Node too: wrap `frame` in an ImageData, or pipe it to ffmpeg as
 * `-f rawvideo -pix_fmt rgba -s WxH -i -`.
 *
 * Commands queue in order and are only drawn as frames are pulled, so a
 * slow consumer falls behind but never misses one. Timing is in frames;
 * the consumer decides how long one lasts.
 */

type RGB = readonly [number, number, number];

export type Command =
  /** Interleaved re/im amplitudes, or the measured basis state of each run.
   *  Copied on push. 1 frame. */
  | { data: Float64Array | number[] }
  /** Move cells to the layout for these qubits over `frames` frames */
  | { select: number[]; frames: number }
  /** 1 frame */
  | { gridLines: boolean };

/** Theme colors, from App.ai.css. EMPTY is a zero brightness cell and the
 *  background, so the gaps that open between moving cells match it. */
const EMPTY: RGB = [0x2c, 0x30, 0x3a]; // --base01
const CELL_LINE: RGB = [0x1a, 0x1d, 0x26]; // --base00
const GROUP_LINE: RGB = [0, 0, 0];
/** In buffer pixels */
const CELL_LINE_WIDTH = 1;
const GROUP_LINE_WIDTH = 4;

const EMPTY_LAB = srgbToOklab(...EMPTY);
/** Lightness of a full brightness cell */
const FULL_L = 0.75;
const CHROMA = 0.13;
/** Rotates phase 0 to red */
const HUE_OFFSET = (29 * Math.PI) / 180;
/** At or below this probability a cell is empty: float noise, not a state. */
const NOISE_FLOOR = 1e-9;
/** Lowest brightness of any cell above the noise floor: ~1.3:1 contrast
 *  against the empty color, clearly a cell with a hint of phase. */
const MIN_BRIGHTNESS = 0.15;

export class Renderer {
  /** Latest drawn frame, RGBA, row-major. Reused, so copy to keep one. */
  frame = new Uint8ClampedArray(0);
  width = 0;
  height = 0;

  private readonly qubits: number;
  private queue: Command[] = [];
  /** Consumers waiting on an empty queue */
  private waiting: (() => void)[] = [];
  /** Draw a frame without a command, after a resize */
  private stale = true;
  /** Last selection pushed, so repeats queue nothing */
  private selected: string;
  private gridLines = true;
  /** Same bytes as frame, one word per pixel, for solid fills */
  private words = new Uint32Array(0);
  /** rgb of each basis state, 3 bytes apiece */
  private readonly colors: Uint8Array;
  /** Basis states in draw order, dimmest first */
  private order: number[];
  private move: Move;
  /** cells[row * cols + col] = basis state, in the layout on screen */
  private cells!: Int32Array;

  constructor(qubits: number, selected: number[] = []) {
    this.qubits = qubits;
    const worlds = 1 << qubits;
    this.colors = new Uint8Array(3 * worlds);
    for (let i = 0; i < worlds; i++) this.colors.set(EMPTY, 3 * i);
    this.order = Array.from({ length: worlds }, (_, i) => i);
    this.selected = selected.join();
    const to = layout(selected, qubits);
    this.move = { from: to.pos, fromLines: to, to, frame: 0, frames: 0 };
    this.retarget(to);
    // Drawable before anyone sizes it, 16 px per cell at 8 qubits
    this.resize(256, 256);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.frame = new Uint8ClampedArray(4 * width * height);
    this.words = new Uint32Array(this.frame.buffer);
    this.wake(true);
  }

  push(command: Command) {
    if ("data" in command) command = { data: command.data.slice() };
    if ("select" in command) {
      const key = command.select.join();
      if (key === this.selected) return;
      this.selected = key;
    }
    this.queue.push(command);
    this.wake();
  }

  /** `for await (const frame of renderer)`: each queued frame in order as
   *  it's pulled. Waits when there are none. */
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (!this.stale && !this.queue.length && this.move.frame >= this.move.frames) {
        await new Promise<void>((resolve) => this.waiting.push(resolve));
      }
      this.stale = false;
      this.step();
      this.draw();
      yield this.frame;
    }
  }

  /** Basis state at frame pixel (x, y), by the layout on screen */
  cellAt(x: number, y: number) {
    const { cols, rows } = this.move.to.grid;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(x / this.width * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(y / this.height * rows)));
    return this.cells[row * cols + col];
  }

  private wake(stale = false) {
    this.stale ||= stale;
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  /** Advance a move in progress, or else take the next command. A move
   *  holds later commands until it lands, as Core waits for it too. */
  private step() {
    const m = this.move;
    if (m.frame < m.frames) {
      m.frame++;
      return;
    }
    const command = this.queue.shift();
    if (!command) return;
    if ("data" in command) this.setData(command.data);
    else if ("gridLines" in command) this.gridLines = command.gridLines;
    else {
      const to = layout(command.select, this.qubits);
      // Frame 1 of the move is drawn now; 0 frames jumps
      this.move = { from: positions(m), fromLines: m.to, to, frame: 1, frames: command.frames };
      this.retarget(to);
    }
  }

  /**
   * Brightness is probability on a log scale, so each halving dims a cell by
   * the same step: certain = full, an even spread over all 2^n worlds =
   * 2/(n+2), and anything below a quarter of that fades to a dim floor, so
   * tiny but real amplitudes stay visible. Probabilities are relative to the
   * total, since the simulator's state isn't normalized. Amplitude color
   * shows phase; runs have none, so results are uncolored.
   */
  private setData(data: Float64Array | number[]) {
    const worlds = 1 << this.qubits;
    let weight: (i: number) => number;
    if (data instanceof Float64Array) {
      let total = 0;
      for (const v of data) total += v * v;
      weight = (i) => (data[2 * i] ** 2 + data[2 * i + 1] ** 2) / (total || 1);
      for (let i = 0; i < worlds; i++) {
        const phase = Math.atan2(data[2 * i + 1], data[2 * i]);
        this.colors.set(encode(weight(i), this.qubits, phase), 3 * i);
      }
    } else {
      const counts = new Uint32Array(worlds);
      for (const r of data) if (r >= 0 && r < worlds) counts[r]++;
      weight = (i) => counts[i] / (data.length || 1);
      for (let i = 0; i < worlds; i++) {
        this.colors.set(cellColor(brightness(weight(i), this.qubits), 0, 0), 3 * i);
      }
    }
    // Moving cells overlap; drawing the largest last keeps them whole on top
    this.order.sort((a, b) => weight(a) - weight(b));
  }

  private draw() {
    const { width, height, move: t } = this;
    const p = progress(t);
    // 0 at rest, 1 from 15% to 85% of a move's progress. Mid-move, cells
    // shrink to 80% over the cell line color, a subtle border, so even
    // identical empty cells read as separate tiles sliding into place.
    const moving = Math.min(1, 6.7 * Math.min(p, 1 - p));
    const scale = 1 - 0.2 * moving;
    this.fill(0, 0, width, height, mix(EMPTY, CELL_LINE, moving));

    // Snap cell edges to whole pixels so gridlines stay crisp.
    const { cols, rows } = t.to.grid;
    const x = (col: number) => Math.round(col * width / cols);
    const y = (row: number) => Math.round(row * height / rows);
    const lines = (stepX: number, stepY: number, w: number, color: RGB, alpha: number) => {
      for (let i = stepX; i < cols; i += stepX) this.fill(x(i) - (w >> 1), 0, w, height, color, alpha);
      for (let i = stepY; i < rows; i += stepY) this.fill(0, y(i) - (w >> 1), width, w, color, alpha);
    };
    // Partition lines cross-fade from the old grouping to the new; they only
    // mean something when groups span several cells. The grid lines toggle
    // hides them too. alpha scales both, for drawing them over the cells.
    const partitions = (alpha: number) => {
      if (!this.gridLines || alpha <= 0) return;
      for (const [l, a] of [[t.fromLines, 1 - p], [t.to, p]] as const) {
        if (l.grouped && a > 0) lines(l.groupCols, l.groupRows, GROUP_LINE_WIDTH, GROUP_LINE, a * alpha);
      }
    };
    // Under the cells, so moving cells visibly cross them. At rest the cells
    // hide this copy and the one drawn over them below shows instead.
    partitions(1);

    for (const i of this.order) {
      const row = t.from[2 * i] + (t.to.pos[2 * i] - t.from[2 * i]) * p;
      const col = t.from[2 * i + 1] + (t.to.pos[2 * i + 1] - t.from[2 * i + 1]) * p;
      // Size comes from the destination cell, so it stays fixed while moving;
      // rounding both edges of a fractional position makes cells wobble.
      const toRow = t.to.pos[2 * i];
      const toCol = t.to.pos[2 * i + 1];
      const w = x(toCol + 1) - x(toCol);
      const h = y(toRow + 1) - y(toRow);
      // Shrunk about the cell's center, in whole pixels
      const sw = Math.round(w * scale);
      const sh = Math.round(h * scale);
      this.fill(
        Math.round(x(toCol) + (col - toCol) * width / cols) + ((w - sw) >> 1),
        Math.round(y(toRow) + (row - toRow) * height / rows) + ((h - sh) >> 1),
        sw, sh, this.colors.subarray(3 * i, 3 * i + 3));
    }

    // Lines over the cells at rest, so groups read clearly. Faded out mid-move,
    // where the gaps between shrunk cells already separate them and fixed
    // lines would cut across the moving tiles.
    if (this.gridLines && moving < 1) lines(1, 1, CELL_LINE_WIDTH, CELL_LINE, 1 - moving);
    partitions(1 - moving);
  }

  private retarget(to: Layout) {
    this.cells = new Int32Array(to.grid.size);
    for (let i = 0; i < to.grid.size; i++) {
      this.cells[to.pos[2 * i] * to.grid.cols + to.pos[2 * i + 1]] = i;
    }
  }

  /** Fill a rect clipped to the buffer, blending color over it by alpha. */
  private fill(x0: number, y0: number, w: number, h: number, color: ArrayLike<number>, alpha = 1) {
    const W = this.width;
    const x1 = Math.min(W, x0 + w), y1 = Math.min(this.height, y0 + h);
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    if (x0 >= x1 || y0 >= y1 || alpha <= 0) return;
    const r = color[0], g = color[1], b = color[2];
    if (alpha >= 1) {
      // Little-endian word, bytes r, g, b, a in memory
      const word = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
      for (let row = y0; row < y1; row++) this.words.fill(word, row * W + x0, row * W + x1);
      return;
    }
    const px = this.frame;
    for (let row = y0; row < y1; row++) {
      for (let i = 4 * (row * W + x0), end = 4 * (row * W + x1); i < end; i += 4) {
        px[i] += (r - px[i]) * alpha;
        px[i + 1] += (g - px[i + 1]) * alpha;
        px[i + 2] += (b - px[i + 2]) * alpha;
      }
    }
  }
}

/** A cell's color for probability p of 2^qubits states, hue from phase. */
export function encode(p: number, qubits: number, phase = 0) {
  return cellColor(brightness(p, qubits), phase);
}

/**
 * Inverse of a cell's color: the probability and phase it shows, out of
 * 2^qubits states. Lossy below the brightness floor, and phase is noise as
 * cells dim to empty.
 */
export function decode(r: number, g: number, b: number, qubits: number) {
  const lab = srgbToOklab(r, g, b);
  const t = Math.min(1, (lab.L - EMPTY_LAB.L) / (FULL_L - EMPTY_LAB.L));
  const p = t < MIN_BRIGHTNESS / 2 ? 0 : 2 ** ((t - 1) * (qubits + 2));
  const h = Math.atan2(lab.b - EMPTY_LAB.b * (1 - t), lab.a - EMPTY_LAB.a * (1 - t)) - HUE_OFFSET;
  return { p, phase: Math.atan2(Math.sin(h), Math.cos(h)) };
}

/** Log-scale brightness over qubits + 2 halvings, floored for real
 *  amplitudes. */
function brightness(p: number, qubits: number) {
  if (p <= NOISE_FLOOR) return 0;
  return Math.min(1, Math.max(MIN_BRIGHTNESS, 1 + Math.log2(p) / (qubits + 2)));
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
export function layout(selected: number[], qubits: number) {
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

interface Move {
  from: Float64Array; // cell positions when it started
  fromLines: Layout; // partition lines faded out
  to: Layout; // cell positions and partition lines faded in
  frame: number; // frames drawn so far
  frames: number;
}

/** Eased progress, 0 → 1, CSS `ease-in-out` timing: cells start slowly and
    build speed, rather than jumping off the mark. */
function progress({ frame, frames }: Move) {
  // ease(1) bisects to just under 1, which would never settle
  return frame >= frames ? 1 : ease(frame / frames);
}

function positions(t: Move) {
  const p = progress(t);
  return t.from.map((v, i) => v + (t.to.pos[i] - v) * p);
}

/** CSS `ease-in-out` = cubic-bezier(0.42, 0, 0.58, 1). Solve x(s) = x,
    return y(s). */
function ease(x: number) {
  const bezier = (s: number, p1: number, p2: number) =>
    3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s ** 2 * p2 + s ** 3;
  let lo = 0, hi = 1, s = x;
  for (let i = 0; i < 20; i++) {
    s = (lo + hi) / 2;
    if (bezier(s, 0.42, 0.58) < x) lo = s;
    else hi = s;
  }
  return bezier(s, 0, 1);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as RGB;
}

/**
 * Domain coloring in OKLCH, the perceptually uniform polar form of OKLab
 * (Björn Ottosson, 2020). Phase walks the hue circle at constant lightness
 * and chroma, an isoluminant cyclic map in the spirit of CET-C6/C7, so no
 * phase looks brighter than another. Brightness (0–1) blends from the
 * empty color (any tint fades out) to full lightness and chroma. Phase 0 =
 * red.
 */
function cellColor(t: number, phase: number, chroma = CHROMA) {
  const C = chroma * t;
  const h = phase + HUE_OFFSET;
  return oklabToRgb(
    EMPTY_LAB.L + (FULL_L - EMPTY_LAB.L) * t,
    EMPTY_LAB.a * (1 - t) + C * Math.cos(h),
    EMPTY_LAB.b * (1 - t) + C * Math.sin(h),
  );
}

/** 0–255 sRGB to OKLab, the inverse of oklabToRgb. */
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

function oklabToRgb(L: number, a: number, b: number): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function gamma(x: number) {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(255 * Math.min(1, Math.max(0, v)));
}
