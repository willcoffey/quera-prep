# Network Requests
To `curl` localhost use the `--noproxy` option. Bash egress otherwise blocks
direct curl. e.g. `curl --noproxy '' http://localhost:8000/`

# Pulsar access
If `dev.ai.sh` was started with `--ai-access` it overrides `compose.yaml`
 exposing the pulsar container to your sandbox network via 
`ports: ["127.0.0.1:8080:8080"]`

# Podman Logs
`dev.ai.sh` saves the last 2000 lines from podman along with appending all new
lines to `.dev/podman.log`. Use tools such as grep to view log file. e.g.
`grep '^task-manager-1 ' .dev/podman.log | tail -n 50` 
to view only lines from `task-manager` service.
