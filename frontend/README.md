# Summary
A quantum computing visualizer with job submission and results viewing. The
visualizer is inspired by block cellular automata, which operate by applying a
local update function to alternating cell neighborhoods. I found that process
similar to a quantum simulator, where neighborhoods can be interpreted as the
bitstring partitions of configuration space and the local update function is
the gate being applied.

The visualizer displays each configuration space entry as a single cell with
its color determined by phase and brightness by magnitude using a log scale.
Whenever the qubit selection is changed, the order of cells is adjusted such
that members of a partition are kept spatially close and the visualizer
animates the cell movement to new grid locations. When a gate is applied it
smoothly animates the state change by applying it in fractional steps.

# Setup
```
cd frontend
npm install
```

# Development
`npm run dev` starts a vite dev server with hot reloading and typechecking on
port 3000.

# Possible Features
 - qasm strings
 - past qasm programs
 - sqrt key
 - more gates

# Playwright Setup Notes
Verify playwright setup. Claude has a tendency to have issues in the sandbox,
and then run the chrome binary manually so it can get a screenshot. Can appear
to be functional but not be.

```sh
mkdir -p ~/playwright-out
claude mcp add \
  -s user                                  `# all projects, not just this dir` \
  playwright                               `# name; tools mcp__playwright__*` \
  --                                       `# rest is the server command` \
  bwrap                                    `# sandbox wrapper` \
  --ro-bind / /                            `# whole filesystem read-only` \
  --dev /dev                               `# minimal /dev, incl. /dev/shm` \
  --proc /proc                             `# fresh /proc` \
  --tmpfs /tmp                             `# private, throwaway /tmp` \
  --bind ~/playwright-out ~/playwright-out `# only writable path` \
  --unshare-pid                            `# isolated process tree` \
  --die-with-parent                        `# exit when Claude exits` \
  playwright-mcp                           `# the MCP server` \
  --headless                               `# no display needed` \
  --isolated                               `# in-memory profile, no cookies` \
  --output-dir ~/playwright-out            `# screenshots, downloads`
claude mcp list
```

