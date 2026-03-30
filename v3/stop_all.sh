#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"

kill_pid_file() {
  local name="$1"
  local pid_file="$LOG_DIR/$name.pid"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[v3] stopping $name (pid=$pid)"
      kill "$pid" || true
    fi
    rm -f "$pid_file"
  fi
}

kill_pid_file "web"
kill_pid_file "serve"
kill_pid_file "ollama"

echo "[v3] stop done"
