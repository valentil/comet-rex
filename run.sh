#!/usr/bin/env bash
# Serve this project locally and open it in your browser.
cd "$(dirname "$0")"
PORT=${1:-8080}
echo "Serving on http://localhost:$PORT  (Ctrl+C to stop)"
( sleep 1; (xdg-open "http://localhost:$PORT" || open "http://localhost:$PORT") >/dev/null 2>&1 ) &
python3 -m http.server "$PORT"
