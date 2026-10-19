# Summary
A mock backend of a spring boot/pulsar/postgres stack running a toy quantum
computer simulator. Additionally, a react frontend showing quantum computation
as block operations on a grid. Akin to block cellular automata with non-local
neighborhood. Cells move on qubit selection to keep neighborhood spatially 
together.

# Current Status
MVP functional, architecture settled. Bugfixes, filling out, review, testing
still remain.

Have a deadline now, 3 days to complete. Spent today getting it to acceptable
point of feature complete. Tomorrow is testing. end to end rendered canvas,
perf tests, unreliable network. Monday is documentation. README.md, mermaid
flow diagram for task path. Tues is code review. cleanup, comments, compare
against idiomatic kotlin repos.

# Tests to write:
 - Fuzzing api
 - Unreliable network via `tc`
 - Performance
    - max bandwidth, before after pulsar/postgres size change
 - Backend results distribution vs frontend amplitudes
 - Rate limits, failure paths

# Other
 - Returned results limit
 - Idemkey on client
 - TaskManager consumes DLQ to populate errors db
 - springdoc for api docs and fuzzing?


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


# Wants
 - Linter & Style
 - Review AI generated algos
 - Principled rule for ordering bitstring partitions
 - CLI for generating webp
 - Build gates that look like rotations in 2d for the partitions.
 - qasm format for strings, ability to load programs into interface

# Notes
Architecture assumes individual runs are expensive enough that the 
message overhead is trivial.

