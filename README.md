# Summary
A mock backend of a spring boot/pulsar/postgres stack running a toy quantum
computer simulator. Additionally, a react frontend showing quantum computation
as block operations on a grid. Akin to block cellular automata with non-local
neighborhood. Cells move on qubit selection to keep neighborhood spatially 
together.

# Current Status
MVP functional, architecture settled. Bugfixes, filling out, review, testing
still remain.

# Setup
For cloudflare tunneling, a token must be provided in `.env`. Any password can
be provided for postgres fields.
```
PG_PASSWORD=...
TASK_MANAGER_DB_PASSWORD=...
TUNNEL_TOKEN="..."
```

# Quick Start
##  Backend
```sh
./dev.ai.sh --rebuild

# Start dev mode on task manager service, allow AI access to pulsar.
./dev.ai.sh task-manager --ai-access

# Build the frontend to be served by nginx container
cd frontend
npm run build
```

## Frontend
From `./frontend/`
```sh
# Start vite dev server
npm run dev
```
---
# Tasks
 - Rate limiting. Caps.
 - Results polling
 - qc error handling

## Tests
 - End to end rendered canvas vs qc.ts
 - Fuzzing api

# Issues
 - Thread safety for program cache
 - Dead letter Q

# Wants
 - Linter & Style
 - Review AI generated algos
 - Principled rule for ordering bitstring partitions

# Notes
Architecture assumes individual runs are expensive enough that the 
message overhead is trivial.

