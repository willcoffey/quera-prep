# Dependencies
Only approved Dependencies are allowed
lucide-icons
react-aria

# Theme
Base16 CSS vars, --base00 to --base0F.
  background: var(--base00);

  base00 bg          base08 error
  base01 panel bg    base09 accent
  base02 selected    base0A warning
  base03 muted       base0B success
  base04 dim fg      base0C info
  base05 fg          base0D primary
  base06 light fg    base0E accent
  base07 light bg    base0F accent

# Core.ts
All domain logic and state exists in this class. UI agnostic. Would
be shared by CLI as well as web app. Core state can only be modified
by dispatching events.

# UI State
UI specific state, such as dark-mode, keyboard layers, display
selection and grid lines follow standard react practices.

## References, if needed
https://react.dev/learn/sharing-state-between-components
https://react.dev/learn/passing-data-deeply-with-context
