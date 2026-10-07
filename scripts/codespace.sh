#!/usr/bin/env bash
# Runs Hot Desk Monitor inside a GitHub Codespace.
# The devcontainer calls `start` every time the Codespace starts or resumes.
#
#   bash scripts/codespace.sh start    # (re)start the app in the background
#   bash scripts/codespace.sh stop     # stop the app (and the demo simulator)
#   bash scripts/codespace.sh status   # address, passwords, process state
#   bash scripts/codespace.sh logs     # follow the app log
#
# Optional settings (Codespaces secrets, or environment variables):
#   ADMIN_TOKEN, SENSOR_API_KEY  passwords; generated and kept in data/ if not set
#   HOTDESK_DEMO=1               also run the sensor simulator so the dashboard has live data
#   HOTDESK_DEMO=fresh           same, but first clear all seats (projects and allocations are kept)
#   HOTDESK_PUBLIC=1             make port 3000 public (phones scanning QR labels, sensor webhooks)
#   AWAY_GRACE_MINUTES, CHECKIN_DURATION_MINUTES, ...  any setting from the README
set -euo pipefail

cd "$(dirname "$0")/.."
DATA=data
PORT="${PORT:-3000}"
mkdir -p "$DATA"
chmod 700 "$DATA"

# The address of this Codespace's forwarded port, e.g. https://name-3000.app.github.dev
if [[ -n "${CODESPACE_NAME:-}" ]]; then
  PUBLIC_URL="${PUBLIC_URL:-https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}}"
else
  PUBLIC_URL="${PUBLIC_URL:-http://localhost:${PORT}}"
fi

# Use the Codespaces secret if set, otherwise a random value generated once and kept in data/.
secret() {
  local name=$1 file="$DATA/.$2"
  if [[ -n "${!name:-}" ]]; then
    echo "${!name}"
  else
    [[ -s "$file" ]] || (umask 077 && node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))" > "$file")
    cat "$file"
  fi
}

stop_pid() {
  local f="$DATA/$1.pid"
  if [[ -f "$f" ]]; then
    local pid; pid=$(cat "$f")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    fi
    rm -f "$f"
  fi
}

# Processes of this checkout started without a pid file (e.g. `npm start` in a terminal) still hold the port.
stop_strays() {
  local pid args
  for pid in $(pgrep -x node 2>/dev/null || true); do
    args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
    case "$args" in
      "node src/index.js "* | "node scripts/simulate.js "*) ;;
      *) continue ;;
    esac
    [[ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" == "$(pwd -P)" ]] && kill "$pid" 2>/dev/null || true
  done
  sleep 0.3
}

running() { [[ -f "$DATA/$1.pid" ]] && kill -0 "$(cat "$DATA/$1.pid")" 2>/dev/null; }

status() {
  local admin key
  admin=$(secret ADMIN_TOKEN admin-token)
  key=$(secret SENSOR_API_KEY sensor-api-key)
  cat <<EOF

  Hot Desk Monitor ($(running app && echo running || echo stopped))
  ─────────────────────────────────────────────────────────────
  Dashboard     ${PUBLIC_URL}/?token=${admin}
  Admin token   ${admin}
  Sensors page  ${PUBLIC_URL}/sensors
  Desk labels   ${PUBLIC_URL}/labels
  Check-in      ${PUBLIC_URL}/checkin?seat=L1-DF-01
  Sensor key    ${key}   (X-Api-Key for ${PUBLIC_URL}/api/integrations/ttn)
  Demo data     $(running sim && echo "on (simulator running)" || echo "off (set HOTDESK_DEMO=1, or: npm run simulate)")
  Logs          bash scripts/codespace.sh logs

EOF
}

start() {
  stop_pid sim
  stop_pid app
  stop_strays
  local admin key
  admin=$(secret ADMIN_TOKEN admin-token)
  key=$(secret SENSOR_API_KEY sensor-api-key)

  # nohup + disown: keep running after the devcontainer's start command returns.
  ADMIN_TOKEN="$admin" SENSOR_API_KEY="$key" PUBLIC_URL="$PUBLIC_URL" PORT="$PORT" \
    nohup node src/index.js >> "$DATA/server.log" 2>&1 < /dev/null &
  echo $! > "$DATA/app.pid"
  disown

  for _ in $(seq 1 50); do
    curl -fs "http://localhost:${PORT}/healthz" > /dev/null 2>&1 && break
    sleep 0.2
  done
  if ! curl -fs "http://localhost:${PORT}/healthz" > /dev/null 2>&1; then
    echo "Hot Desk Monitor did not start. Last log lines:" >&2
    tail -n 20 "$DATA/server.log" >&2
    exit 1
  fi

  # HOTDESK_DEMO=1 runs the simulator; HOTDESK_DEMO=fresh first clears all seats (keeps projects and allocations).
  if [[ "${HOTDESK_DEMO:-}" == 1 || "${HOTDESK_DEMO:-}" == fresh ]]; then
    local reset=(); [[ "${HOTDESK_DEMO}" == fresh ]] && reset=(--reset)
    SENSOR_API_KEY="$key" ADMIN_TOKEN="$admin" nohup node scripts/simulate.js "http://localhost:${PORT}" "${reset[@]}" >> "$DATA/simulator.log" 2>&1 < /dev/null &
    echo $! > "$DATA/sim.pid"
    disown
  fi

  if [[ "${HOTDESK_PUBLIC:-}" == 1 && -n "${CODESPACE_NAME:-}" ]] && command -v gh > /dev/null; then
    gh codespace ports visibility "${PORT}:public" -c "$CODESPACE_NAME" > /dev/null 2>&1 \
      && echo "Port ${PORT} is public." \
      || echo "Could not make port ${PORT} public automatically. Use the Ports tab → right-click → Port Visibility → Public."
  fi

  status | tee "$DATA/codespace-info.txt" > /dev/null
  status
}

case "${1:-start}" in
  start) start ;;
  stop) stop_pid sim; stop_pid app; stop_strays; echo "Stopped." ;;
  status) status ;;
  logs) tail -n 50 -f "$DATA/server.log" ;;
  *) echo "usage: $0 start|stop|status|logs" >&2; exit 2 ;;
esac
