# Summary
This repo is the learning artifact from building a toy quantum computing
job orchestration system. A Kong gateway routes requests to a Kotlin/Spring
Boot backend which uses Pulsar as a message broker and Postgres as its
database. A React frontend provides visualization of the quantum state as well
as controls for submitting and fetching jobs. All containerized in a rootless
Podman setup.

# Setup
Requires `podman` and `node` be installed.

For initial setup a `.env` file in the repo root must be created with passwords
created for Postgres.
```
PG_PASSWORD=...
TASK_MANAGER_DB_PASSWORD=...
```

Optionally, the tunnel profile can be enabled if a Cloudflare token is provided.
This makes it simple to make the setup externally accessible when it is running
in a sandboxed environment.
```
COMPOSE_PROFILES=tunnel
TUNNEL_TOKEN="..."
```

# Quick Start
Build the backend
```
podman compose build
```

Build the frontend
```
cd frontend
npm install
npm run build
```

Start the server (from repo root)
```
podman compose up
```

In a web browser load `http://localhost:8000` or the Cloudflare path to see the
web app.

# Development
A development helper script, `dev.ai.sh`, is provided to streamline dev work.
See `./dev.ai.sh -h` for help. Some use cases include:

A command like `./dev.ai.sh task-manager --ai-access` starts development on the
specified (task-manager) service and publishes the Pulsar HTTP port so that an
agent can access it. The target service is run as a single replica with Gradle
watching and rebuilding on file change.

 - `./dev.ai.sh --rebuild` - Rebuild the images. Same as `podman compose build`
 - `./dev.ai.sh --delete-all` - Deletes containers, Pulsar and Postgres volumes

# Architecture
The architecture of this project was driven by the choice of tech stack more
than the problem itself. Instead of having a problem and deciding how to solve
it, I took a set of technologies and asked myself how they would be used to
solve the problem. The result is:

- A Kong gateway for routing & rate limiting
- A Pulsar message broker for distributing jobs to processors
- A Postgres database for storing programs and results
- A Podman setup with multiple replicas of the job processors

The largest assumption that drove the architecture is that each "run" is
expensive. This lets me ignore the overhead of creating 1000 individual messages
when a task is submitted with 1000 runs. Since each run will have far more
overhead than a single message, the inefficiency doesn't matter. It also
simplifies future work around tenancy and task priority.

The run messages use a content addressed program, which both lets the messages
remain small and allows fetching results for all runs of the same program,
instead of just the shots associated with a single task.

Duplicate runs also get recorded, since the assumption is that the quantum
computer is expensive, and any information it provides should be retained.

# Out of scope
 - Authentication and tenancy
 - ResultsTransformer : `/results` simply returns raw results.

# Issues
 - Error handling in QuantumComputer, DLQ catches too much and nothing
   consumes it
 - `/results` is unbounded
 - The `Client` never retries on failure, never reuses an idemKey
 - Global rate limiting vs per-client


