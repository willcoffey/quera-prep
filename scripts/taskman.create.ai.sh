#!/usr/bin/env bash
# Submits a task to task-manager through kong with an idempotency key.
# Usage: taskman.create.ai.sh [idemKey]  (random 64-char hex if omitted)
set -euo pipefail

# Server requires exactly 64 alphanumeric chars.
IDEM_KEY="${1:-$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"

curl -sS --noproxy '' -X POST http://localhost:8000/tasks/create \
  -H 'Content-Type: application/json' \
  --data @- <<EOF
{
  "idemKey": "$IDEM_KEY",
  "commands": [
    "SELECT 1",
    "H",
    "SELECT 1 2 3",
    "CNOT",
    "SELECT 3 2",
    "T"
  ]
}
EOF
echo
