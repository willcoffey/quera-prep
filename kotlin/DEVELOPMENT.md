# Development guide for kotlin services
Development is intended to happen on one service at a time. All other services
will run similar to prod, compiled and containerized.

The target service also runs in a container, but with the gradle runtime,
bootRun, and file watching. This way it's network still acts the same as if it
was compiled.


# Develop a service
Build all the services, rerun whenever something outside the development target
changes.
`podman compose build`

Start development on target service (`task-manager`), it hot reloads on code
changes. 
`./dev.ai.sh task-manager`

In a second terminal, attach to the target service for viewing output only
`podman compose logs -f task-manager`


# Add a service
1. Copy an existing service, then refactor it's namings.
2. Add it to `compose.yaml`
3. Add it's API routes in `kong/kong.yml`
4. run `./dev.ai.sh new-service` and confirm it comes up.

# dev.ai.sh
Writes a dev mode compose override for the given service to `.dev/`, builds the
service, then runs
`podman compose -f compose.yaml -f .dev/compose.<service>.yaml up`
It also saves the last 2000 lines of logs + anything new to `.dev/podman.log`
for llm agent access.
