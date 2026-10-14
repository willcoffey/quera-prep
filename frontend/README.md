# Summary
A quantum computing visualization. Treat qubits as neighborhood selection. Gate
is update rule. It's a block cellular automaton with non-local neighborhood.

Host dev server on port 3000
`npm run dev`

Build static assets, served via nginx container
`npm run build`

# Issues
 - Map button bypasses the promise chain, add map command. possibly combine gate
matrices into larger matrix.
 - Replay & user input both have delay. Delay should be removed for user input.

# Features
 - qasm strings
 - past qasm programs
 - sqrt key
 - more gates


# Playwright Setup
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
