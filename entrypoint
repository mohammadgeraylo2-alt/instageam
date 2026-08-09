#!/bin/sh
set -e

QUOTA_CHECK_INTERVAL=${QUOTA_CHECK_INTERVAL:-60}
mkdir -p "${XRAY_STATE_DIR:-/data}"

python3 /app/app.py render

start_xray() {
  xray run -config /etc/xray/config.json &
  XRAY_PID=$!
  echo "[entrypoint] Xray started (pid $XRAY_PID)"
}

start_xray
sleep 5

python3 /app/app.py manage &

# ری‌استارت سریع بعد از ساخت کاربر جدید یا حذف کاربر منقضی
(
  while true; do
    sleep 5
    if [ -f /tmp/config_changed ]; then
      rm -f /tmp/config_changed
      echo "[entrypoint] Config changed, restarting Xray..."
      kill "$XRAY_PID" 2>/dev/null || true
      wait "$XRAY_PID" 2>/dev/null || true
      start_xray
      sleep 2
    fi
  done
) &

while true; do
  sleep "$QUOTA_CHECK_INTERVAL"
  if ! kill -0 "$XRAY_PID" 2>/dev/null; then
    echo "[entrypoint] Xray process died, restarting..."
    start_xray
    sleep 5
  fi
  python3 /app/app.py quota-check
done
