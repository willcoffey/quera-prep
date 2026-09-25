# Development guide for kotlin services
Development is intended to happen on one service at a time. All other services
will run similar to prod, compiled and containerized.

The target service also runs in a container, but with the gradle runtime,
bootRun, and file watching. This way it's network still acts the same as if it
was compiled.

## Rebuild all services
To initially build the docker images, or update them after a change all services
can be rebuilt with the following command.
`podman compose build`

## Start Development
Specify the service that will be edited via docker compose config. The following
command uses the main `compose.yaml`, but overrides the service settings for the
target service with its development image. All compile errors and log statements
will show in the terminal.

```
podman compose -f compose.yaml -f kotlin/services/<service>/compose.dev.yaml up
```
