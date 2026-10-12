See `frontend/src/App.tsx` for component usage.
See `frontend/architecture.md` for general context.

Only edit the two `.tsx` and `.css` files for this component.

Use react-aria components as applicable

---

**INITIAL PROTOTYPE**
Initialize your own random values for vector space. 
random values, with contraint that total squared magnitude = 1.

---

This is a pure display component with no side effects.

For performance reasons, a canvas will be needed instead of DOM
elements.

Each entry in the vector space will be displayed as a cell in the
grid, with it's position determined by the current qubit selection.
Color cells by phase and magnitude, with a cyclic map aligned 
with human color perception. Use a reference map, but don't import
code.

Cells will be grouped together based on selected qubits. If 1 qubit
is selected group size is 2. 2 selected is 4. 3 selected is 8, and
so forth. Each group is the partition that unitary matricies get 
applied to.

Groups should be landscape oriented when applicable, and ordered in
the same way they would be in a matrix representation when being
multiplied with a standard gate matrix.

The grid should have two sets of gridlines.
1. gridlines between every cell
2. thicker gridlines between partitions that change as qubit 
selection changes.


# Animations

When the qubit selection changes, the transition as cells move to 
their new positions should be animated. Don't reinvent architecture
for this, follow existing patterns from CSS animations.

animation time should be .3 seconds. If I click 10 different
selections in rapid succession, it should still take .3 seconds from
last click.
