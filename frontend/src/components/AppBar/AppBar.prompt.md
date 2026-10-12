See `frontend/src/App.tsx` for component usage.
See `frontend/architecture.md` for general context.

Only edit the two `.tsx` and `.css` files for this component.

Use react-aria components when they make sense. test purely via
keyboard input, `tab` etc in playwright.

This component has two pieces of UI only state.

simulation results toggle
grid lines toggle 

It emits a single event
"run-job"

The app bar consists of
    - program id : A read only, selectable text-area that displays
      a string, `core.state.programId`
    - a button, lucide grid-2x2, that toggles gridlines
    - a button, lucide monitor-cog, that toggles simulation results
    - a button, two lines, text, "Run Job", emits `run-job`
    - a button, lucide menu, opens the menu with
        5 lorem ipsum placeholders

The lucide icon toggles between base05 and base09 accent
