#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "[v3] root: $ROOT_DIR"

is_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

start_ollama() {
  if curl -sS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    echo "[v3] ollama already running on 11434"
    return
  fi

  if ! command -v ollama >/dev/null 2>&1; then
    echo "[v3] ollama command not found, please install ollama first"
    return
  fi

  echo "[v3] starting ollama..."
  nohup ollama serve >"$LOG_DIR/ollama.log" 2>&1 &
  echo $! >"$LOG_DIR/ollama.pid"
  sleep 2
  if curl -sS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
    echo "[v3] ollama started"
  else
    echo "[v3] ollama did not become ready yet; check $LOG_DIR/ollama.log"
  fi
}

install_if_needed() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "[v3] installing dependencies in $dir"
    (cd "$dir" && npm install)
  fi
}

start_serve() {
  local dir="$ROOT_DIR/serve"
  install_if_needed "$dir"

  if is_listening 3000; then
    echo "[v3] serve already running on 3000"
    return
  fi

  echo "[v3] starting serve..."
  nohup bash -lc "cd \"$dir\" && npm run dev" >"$LOG_DIR/serve.log" 2>&1 &
  echo $! >"$LOG_DIR/serve.pid"
}

start_web() {
  local dir="$ROOT_DIR/web"
  install_if_needed "$dir"

  if [ ! -f "$dir/.env" ]; then
    cp "$dir/.env.example" "$dir/.env"
  fi

  if is_listening 5173; then
    echo "[v3] web already running on 5173"
    return
  fi

  echo "[v3] starting web..."
  nohup bash -lc "cd \"$dir\" && npm run dev" >"$LOG_DIR/web.log" 2>&1 &
  echo $! >"$LOG_DIR/web.pid"
}

start_ollama
start_serve
start_web

echo
echo "[v3] done"
echo "  serve: http://127.0.0.1:3000"
echo "  web:   http://127.0.0.1:5173"
echo "  logs:  $LOG_DIR"
