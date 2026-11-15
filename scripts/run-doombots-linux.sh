#!/usr/bin/env bash
# Start the five DoomBots with one low-memory Ollama server on Linux.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="qwen2.5:0.5b"
export OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_API="${OLLAMA_URL%/}"
OLLAMA_PID=""

fail() {
    echo "DoomBots: $*" >&2
    exit 1
}

cleanup() {
    if [[ -n "$OLLAMA_PID" ]] && kill -0 "$OLLAMA_PID" 2>/dev/null; then
        echo "DoomBots: stopping the Ollama server started for this session."
        kill "$OLLAMA_PID" 2>/dev/null || true
        wait "$OLLAMA_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

is_local_ollama() {
    [[ "$OLLAMA_API" == http://127.0.0.1:* || "$OLLAMA_API" == http://localhost:* ]]
}

wait_for_ollama() {
    for _ in {1..30}; do
        if curl --fail --silent --show-error "$OLLAMA_API/api/tags" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done
    return 1
}

cd "$ROOT_DIR"
command -v node >/dev/null || fail "Node.js 18–22 is required."
command -v curl >/dev/null || fail "curl is required (install it with your Linux package manager)."
[[ -d node_modules ]] || fail "Dependencies are missing. Run: npm install"

if [[ -r /proc/meminfo ]]; then
    memory_kib="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
    if (( memory_kib < 4500000 )); then
        echo "DoomBots warning: less than about 4.5 GB RAM detected; five bots may not be stable." >&2
    fi
fi

if ! wait_for_ollama; then
    is_local_ollama || fail "Ollama is unavailable at $OLLAMA_API. Start the remote Ollama server and pull $MODEL there."
    command -v ollama >/dev/null || fail "Ollama is required. Install it, then run this command again."

    echo "DoomBots: starting one low-memory Ollama server at $OLLAMA_API"
    OLLAMA_HOST="${OLLAMA_API#http://}" \
    OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}" \
    OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}" \
    OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-15m}" \
        ollama serve >"${TMPDIR:-/tmp}/doombots-ollama.log" 2>&1 &
    OLLAMA_PID="$!"
    wait_for_ollama || fail "Ollama did not start. See ${TMPDIR:-/tmp}/doombots-ollama.log"
fi

if ! curl --fail --silent --show-error \
    --request POST "$OLLAMA_API/api/show" \
    --header 'Content-Type: application/json' \
    --data "{\"name\":\"$MODEL\"}" >/dev/null 2>&1; then
    is_local_ollama || fail "$MODEL is not available at $OLLAMA_API. Pull it on that Ollama server first."
    command -v ollama >/dev/null || fail "$MODEL is missing and the Ollama CLI is unavailable."
    echo "DoomBots: pulling $MODEL (one-time download)"
    ollama pull "$MODEL"
fi

node ./scripts/check-doombots-config.mjs

# Each bot inherits this cap. It protects the host while leaving room for one 0.5B
# model and a small headless Minecraft server inside a 5 GB machine.
export DOOMBOTS_AGENT_HEAP_MB="${DOOMBOTS_AGENT_HEAP_MB:-384}"
if [[ " ${NODE_OPTIONS:-} " != *" --max-old-space-size="* ]]; then
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$DOOMBOTS_AGENT_HEAP_MB"
fi

export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-15m}"

echo "DoomBots: starting five bots with $MODEL at $OLLAMA_API"
node main.js
