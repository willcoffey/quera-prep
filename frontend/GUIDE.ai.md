# Frontend Implementation Guide

React 19 + Vite 8 + react-aria-components + lucide-react, based on
`~/repos/run-simply`. Verified against the versions below on 2026-10-09
(`tsc` passes, `vite build` passes, dev server + proxy tested).

## Layout
```
frontend/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    App.tsx      # React UI + entry point (createRoot)
    Core.ts      # app logic, no React/DOM imports; runs headless
```
Add as needed, not before:
- `src/App.css`, `src/components/<Name>/<Name>.tsx` (+ `.css`)
- `public/` for files served verbatim (see Dev Server)

## Infra Files

`package.json`
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsc --watch --preserveWatchOutput & vite",
    "build": "vite build",
    "check": "tsc"
  },
  "dependencies": {
    "lucide-react": "^1.54.0",
    "react": "^19.3.0",
    "react-aria-components": "^1.22.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "typescript": "^7.0.2",
    "vite": "^8.3.4"
  }
}
```

`tsconfig.json`
```json
{
  "include": ["src"],
  "compilerOptions": {
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["vite/client"]
  }
}
```

`vite.config.ts`
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

`index.html`
```html
<!doctype html>
<div id="root"></div>
<script type="module" src="/src/App.tsx"></script>
```
## Core / App Split
`Core.ts` holds state and talks to the API; `App.tsx` only renders. Same
idea as run-simply's `Core` and secure-clip's `core.ts`: the core can be
driven from tests or a CLI without a browser.
```tsx
// src/App.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Core } from "./Core";

const core = new Core();

function App() {
  return <h1>quera-mirror</h1>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
```

## react-aria-components
Unstyled, accessible components. Import from one package:
```tsx
import { Button } from "react-aria-components";
<Button onPress={() => core.submit()}>Run</Button>
```
- Use `onPress`, not `onClick` (normalizes mouse/touch/keyboard).
- Each component gets a default class, `.react-aria-<Name>`; pass
  `className` to override.
- Style states with data attributes, not pseudo-classes:
  `[data-hovered]`, `[data-pressed]`, `[data-focus-visible]`,
  `[data-disabled]`, `[data-selected]`.
```css
.react-aria-Button[data-focus-visible] { outline: 2px solid var(--accent); }
```

## lucide-react
Named imports, tree-shaken; each icon is an inline SVG component.
```tsx
import { Atom } from "lucide-react";
<Atom size={16} />            // size, color, strokeWidth props
```
Icons inherit `currentColor`, so color them via the parent's CSS `color`.

## Dev Server
```sh
npm run dev            # http://localhost:5173, plus tsc --watch
npm run dev -- --host  # also reachable from outside the VM
npm run check          # one-off type check
npm run build          # bundle to dist/
```
- Saves show up live: TS/TSX hot-swaps, CSS applies in place, HTML reloads.
- `/tasks/*` proxies to Kong on `:8000`; the compose stack must be up.
- Static files:
  - `frontend/<name>.html` → `/<name>.html`: can import from `/src`; dev
    only.
  - `public/<name>` → `/<name>`: served as-is; copied to `dist/`.
