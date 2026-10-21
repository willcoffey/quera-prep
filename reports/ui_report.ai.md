# UI Exploration Report

Tested with Playwright at 1280x720 and 320x568, mostly at instant (∞) speed.

## Controls
- Toolbar: grid lines, simulation results view, animation speed (cycles
  .5×/1×/2×/∞), read-only Program ID, Submit, Pull, and a Menu with 6 preset
  circuits (Shor 15/35, quantum walk, Grover, Simon's, random).
- Qubits Q0–Q7 toggle, and their order sets the controls first, then the
  target. The gate keys adapt to the selection: 1 qubit gives H/T/X/Z, 2 gives
  •X/•Z/•T/⇄, 3 adds Fredkin, and 4–8 give ⁿX/ⁿZ/ⁿT. MAP applies a
  single-qubit gate to every qubit, INV swaps T for T†, DEL clears the
  selection, and AC resets everything. The selection stays after a gate is
  applied.
- Keyboard: Tab order, arrows/Home/End move between keys, Enter/Space press
  them. There are no global hotkeys.

## Results
All 12 gate families applied with correct Last labels. 300 rapid random
clicks, mashing every key, AC during a replay and the phone layout caused no
page errors and no overflow. Buffered gates applied in order. Grover takes
~1.2s at ∞.

## Errors
1. **Polling with an empty ID**: after Pull, pressing AC leaves
   `Client.subscribe` polling `GET /tasks/results/` (404) every 1s, then
   every 10s, until the bucket drains (`Client.ts:126`).
2. The gate keys update one frame (~22ms) after a qubit click, so a very
   fast click can hit the previous gate set.
3. INV mode stays on after AC.
4. The read-only Order/Last screens are Tab stops.
