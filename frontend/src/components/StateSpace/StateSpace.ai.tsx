import "./StateSpace.ai.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Renderer } from "../../Renderer.ai";

/** Frames per second, as Core steps gates */
const FRAMERATE = 60;

interface StateSpaceProps {
  /** Core's renderer; Core pushes everything it draws */
  renderer: Renderer;
  selectedQubits: number[];
  /** ms Core waits after a selection change; 0 jumps */
  animationSpeed: number;
  /** interleaved re/im amplitudes; Core mutates it in place */
  stateVector: Float64Array;
  /** measured basis state of each run */
  results?: number[];
  /** Whether the renderer is showing results, for the label */
  showResults: boolean;
}

export function StateSpace({
  renderer,
  selectedQubits,
  stateVector,
  results,
  showResults,
}: StateSpaceProps) {
  const qubits = Math.round(Math.log2(stateVector.length / 2));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useDevicePixelSize(canvasRef);
  const selectionKey = `${qubits}:${selectedQubits.join()}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    renderer.resize(size.width, size.height);
  }, [renderer, size]);

  // Shows each frame as it's drawn, one per FRAMERATE tick
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    // Aborting ends the loop without taking a frame, even one parked
    // waiting for a command, so a remount's stale loop can't steal one
    const abort = new AbortController();
    (async () => {
      for await (const frame of renderer.frames(abort.signal, { latest: true })) {
        if (abort.signal.aborted) return;
        if (renderer.width && renderer.height) {
          ctx.putImageData(new ImageData(frame, renderer.width, renderer.height), 0, 0);
        }
        await new Promise((r) => setTimeout(r, 1000 / FRAMERATE));
      }
    })();
    return () => abort.abort();
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
