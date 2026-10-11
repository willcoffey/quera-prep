

# Playwright Setup
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
