See `frontend/src/App.tsx` for component usage.
See `frontend/architecture.md` for general context.

Only edit the two `.tsx` and `.css` files for this component.

Use react-aria components as applicable
test purely via keyboard input (`tab` etc in playwright).


This component is a row of:
```html pseudocode
<QubitOrderDisplay />
<QubitButtons />
```

where QubitOrderDisplay is a display of the selected qubits,
in order. i.e. `0 1 3` up to all 8. Indeterminate as to how
to usably display. 

QubitButtons are two rows of 4 buttons. Q subscript 0 to 7

They are toggle on and off. order matters.

dispatches a select-qubits event with full selection on change

note, currently display won't change due to no implementation in 
core, still dispatch the events
