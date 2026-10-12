See `frontend/src/App.tsx` for component usage.
See `frontend/architecture.md` for general context.

Only edit the two `.tsx` and `.css` files for this component.

Use react-aria components as applicable
test purely via keyboard input (`tab` etc in playwright).


This component is a grid of buttons a'la a scientific calculator.

It has 14 buttons total, with 10 dedicated to quantum gates, and
4 dedicated to control.


# Control Buttons
last two buttons of each row. A darker shade

- Map : Toggles the keyboard to only show the single qubit gates and 
the Behaviour of clicking. Which now sends a map event with the gate
and selected qubits.

- CE : dispatches an empty qubit selection event
- AC : dispatches a reset event
- Inverse : Changes Behaviour of buttons, now when gates get clicked
they include inverst : true as an argument.

# Gate Buttons
Gate buttons dispatch an event when clicked. Which buttons are
displayed is a function of selected qubits and the map option.

By default, only gates that match the number of selected qubits 
appear. 3 selected, 3 qubit gates and so forth.

As to gates, select based on the following
- maximum of 10 per qubit count
- compatible with error correction

And imagine running through some toy algorithms, what gates would
be needed or useful
