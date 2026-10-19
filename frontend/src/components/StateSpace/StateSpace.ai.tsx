import "./StateSpace.ai.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DisplayOptions } from "../../App";
import { Renderer } from "../../Renderer.ai";

/** Frames per second, as Core steps gates */
const FRAMERATE = 60;

interface StateSpaceProps {
  displayOptions: DisplayOptions;
  selectedQubits: number[];
  /** ms Core waits after a selection change; 0 jumps */
  animationSpeed: number;
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
  animationSpeed,
  stateVector,
  version,
  results,
}: StateSpaceProps) {
  const qubits = Math.round(Math.log2(stateVector.length / 2));
  const { gridLines, showResults } = displayOptions;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useDevicePixelSize(canvasRef);
  const selectionKey = `${qubits}:${selectedQubits.join()}`;
  // A new qubit count is a new grid, with nothing to animate from
  const renderer = useMemo(() => new Renderer(qubits, selectedQubits), [qubits]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    renderer.resize(size.width, size.height);
  }, [renderer, size]);
  useEffect(() => renderer.push({ gridLines }), [renderer, gridLines]);
  // stateVector is the same array after every gate, so version is the dep.
  useEffect(() => {
    // The toggle decides the view; no results yet shows an empty grid
    renderer.push({ data: showResults ? results ?? [] : stateVector });
  }, [renderer, showResults, results, stateVector, version]);
  useEffect(() => {
    // Core waits this long after a selection change before the next gate,
    // so the move finishes before cells start changing.
    const frames = reducedMotion() ? 0 : Math.round(animationSpeed * FRAMERATE / 1000);
    renderer.push({ select: selectedQubits, frames });
  }, [renderer, selectionKey]);

  // Shows each frame as it's drawn, one per FRAMERATE tick
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let stopped = false;
    (async () => {
      for await (const frame of renderer) {
        if (stopped) return;
        if (renderer.width && renderer.height) {
          ctx.putImageData(new ImageData(frame, renderer.width, renderer.height), 0, 0);
        }
        await new Promise((r) => setTimeout(r, 1000 / FRAMERATE));
      }
    })();
    return () => { stopped = true; };
  }, [renderer]);

  const [hover, setHover] = useState<{ state: number; x: number; y: number }>();
  // Cells move on a selection change, so the cell under the pointer is no
  // longer the one named; cleared until the pointer moves again
  useEffect(() => setHover(undefined), [selectionKey]);
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const state = renderer.cellAt(x / r.width * renderer.width, y / r.height * renderer.height);
    setHover({ state, x, y });
  };
  // Kept inside the grid by its measured width, before paint
  const tipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tip = tipRef.current, box = tip?.parentElement;
    if (!tip || !box || !hover) return;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(box.clientWidth - half, Math.max(half, hover.x))}px`;
  }, [hover]);

  return (
    <div className="StateSpace">
      <canvas
        ref={canvasRef}
        className="StateSpace-canvas"
        role="img"
        aria-label={(showResults
          ? `Results of ${results?.length ?? 0} runs over ${1 << qubits} basis states, `
          : `State vector of ${qubits} qubits, ${1 << qubits} amplitudes, `) +
          `grouped by ${selectedQubits.length} selected ` +
          `qubit${selectedQubits.length === 1 ? "" : "s"}`}
        onPointerMove={onPointerMove}
        // A tap sends no move, so show on down; a finger "leaves" as it
        // lifts, so touch keeps the tip until the next tap
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => e.pointerType !== "touch" && setHover(undefined)}
      />
      {hover && (
        // Bit string, highest qubit first: |q7 … q0⟩
        <div
          ref={tipRef}
          className="StateSpace-tip"
          style={{ left: hover.x, top: hover.y }}
          // Flipped under the pointer near the top, which would clip it
          data-below={hover.y < 40 || undefined}
          aria-hidden
        >
          {hover.state.toString(2).padStart(qubits, "0")}
        </div>
      )}
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

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
