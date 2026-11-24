#!/usr/bin/env bash
set -e

export OMNIRAG_BACKEND_URL="http://127.0.0.1:${PORT:-3000}"
export VOICE_SERVICE_URL="http://127.0.0.1:8010"

echo "[Startup] Starting OmniRAG Python Voice Sidecar on port 8010..."
/app/voice-service/.venv/bin/uvicorn voice_orchestrator:app \
  --app-dir /app/voice-service \
  --host 127.0.0.1 \
  --port 8010 &

echo "[Startup] Starting OmniRAG Express Server on port ${PORT:-3000}..."
exec node src/server.js