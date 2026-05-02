#!/usr/bin/env bash
# Usage:
#   ./axl.sh setup [--docker]        clone repo, build binary (native), generate keys (1-5)
#   ./axl.sh start [--docker] [N]    start N nodes (default 3; use 5 for cyber-incident)
#   ./axl.sh stop  [--docker]
#   ./axl.sh status
#   ./axl.sh logs [1|2|3|4|5]

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS="$DIR/keys"
LOGS="$DIR/logs"
PIDS="$DIR/.pids"
SRC="$DIR/axl-source"
BIN="$DIR/bin/axl"
REPO="https://github.com/gensyn-ai/axl"

api_port() { echo $((9002 + ($1 - 1) * 10)); }

is_running() {
  local f="$PIDS/node-$1.pid"
  [[ -f "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null
}

# macOS LibreSSL doesn't support ed25519, prefer Homebrew openssl
find_openssl() {
  if [[ -x "/opt/homebrew/opt/openssl/bin/openssl" ]]; then
    echo "/opt/homebrew/opt/openssl/bin/openssl"
  else
    echo "openssl"
  fi
}

gen_keys() {
  mkdir -p "$KEYS"
  local ssl; ssl=$(find_openssl)
  for i in 1 2 3 4 5; do
    local f="$KEYS/private-$i.pem"
    [[ -f "$f" ]] && continue
    $ssl genpkey -algorithm ed25519 -out "$f" 2>/dev/null
    chmod 600 "$f"
    echo "generated $f"
  done
}

cmd_setup() {
  local docker=false
  [[ "${1:-}" == "--docker" ]] && docker=true

  if [[ ! -d "$SRC/.git" ]]; then
    git clone "$REPO" "$SRC"
  fi

  if ! $docker; then
    mkdir -p "$DIR/bin"
    echo "building... (may take ~30s)"
    cd "$SRC"
    GOTOOLCHAIN=go1.25.5 go build -o "$BIN" ./cmd/node/ 2>/dev/null \
      || go build -o "$BIN" ./cmd/node/
    cd "$DIR"
    echo "built: bin/axl"
  fi

  gen_keys
  echo "setup done"
}

cmd_start() {
  local docker=false
  local count=3
  for arg in "${@}"; do
    [[ "$arg" == "--docker" ]] && docker=true
    [[ "$arg" =~ ^[0-9]+$ ]] && count="$arg"
  done

  if $docker; then
    [[ ! -f "$KEYS/private-1.pem" ]] && gen_keys
    cd "$DIR" && docker compose up -d --remove-orphans
    return
  fi

  [[ ! -f "$BIN" ]] && { echo "run setup first"; exit 1; }
  [[ ! -f "$KEYS/private-1.pem" ]] && { echo "run setup first"; exit 1; }

  mkdir -p "$PIDS" "$LOGS"
  # kill stale
  for f in "$PIDS"/node-*.pid; do
    [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"
  done

  cd "$DIR"
  for (( i=1; i<=count; i++ )); do
    "$BIN" -config "node-configs/node-$i.json" > "$LOGS/node-$i.log" 2>&1 &
    echo $! > "$PIDS/node-$i.pid"
    echo "node-$i  pid=$!  api=:$(api_port $i)"
    sleep 0.3
  done
}

cmd_stop() {
  local docker=false
  [[ "${1:-}" == "--docker" ]] && docker=true

  if $docker; then
    cd "$DIR" && docker compose down
    return
  fi

  local n=0
  for f in "$PIDS"/node-*.pid; do
    [[ -f "$f" ]] || continue
    kill "$(cat "$f")" 2>/dev/null && ((n++)) || true
    rm -f "$f"
  done
  echo "stopped $n node(s)"
}

cmd_status() {
  for i in 1 2 3 4 5; do
    local port; port=$(api_port $i)
    if is_running $i; then
      local key
      key=$(curl -sf "http://127.0.0.1:$port/topology" 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('our_public_key','?'))" 2>/dev/null || echo "?")
      echo "node-$i  running  :$port  $key"
    else
      echo "node-$i  stopped"
    fi
  done
}

cmd_logs() {
  local node="${1:-}"
  if [[ -n "$node" ]]; then
    tail -f "$LOGS/node-$node.log"
  else
    tail -f "$LOGS"/node-*.log
  fi
}

case "${1:-}" in
  setup)  cmd_setup  "${2:-}" ;;
  start)  cmd_start  "${2:-}" ;;
  stop)   cmd_stop   "${2:-}" ;;
  status) cmd_status ;;
  logs)   cmd_logs   "${2:-}" ;;
  *)
    echo "usage: axl.sh <setup|start|stop|status|logs> [--docker]"
    ;;
esac
