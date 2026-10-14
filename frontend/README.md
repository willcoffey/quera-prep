# Sumamry

A basic setup for Typescript and react. To run the dev server:
`npm run dev`
to build static assets
`npm run build`

Assets are served by an nginx docker container during prod.

---

# Future issues
I'm omitting a lot of features to get this in a usable state, but they should be
addressed some ways.

No rate-limiting on job requests. And since they are triggered by the `run-job`
event they could hypothetically end up in future replays. So executed even 
faster than a user can click.

Generic dump of `response.text()` on fetch errors, instead of using Spring 
error message standards.


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
