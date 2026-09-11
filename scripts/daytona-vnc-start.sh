#!/usr/bin/env bash
# Boots the VNC desktop stack and runs the mausCode Electron app on it.
# Usage (inside the sandbox, from the repo root):
#   bash scripts/daytona-vnc-start.sh
# Then expose port 6080 in the Daytona dashboard and open it in a browser.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DISPLAY_NUM="${VNC_DISPLAY_NUM:-99}"
VNC_GEOMETRY="${VNC_GEOMETRY:-1600x900}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
LOG_DIR="$REPO_ROOT/.daytona-vnc-logs"

export DISPLAY=":${DISPLAY_NUM}"

say() { echo "==> $*"; }
running() { pgrep -f "$1" >/dev/null 2>&1; }

mkdir -p "$LOG_DIR"

# ------------------------------------------------------------------ Xvfb
if running "Xvfb :${DISPLAY_NUM}"; then
  say "Xvfb :${DISPLAY_NUM} already running."
else
  say "Starting Xvfb :${DISPLAY_NUM} (${VNC_GEOMETRY})…"
  rm -f "/tmp/.X${DISPLAY_NUM}-lock"
  # shellcheck disable=SC2086
  nohup Xvfb ":${DISPLAY_NUM}" -screen 0 "${VNC_GEOMETRY}x24" >"$LOG_DIR/xvfb.log" 2>&1 &
  sleep 2
fi

# ---------------------------------------------------------- window manager
if running "openbox"; then
  say "openbox already running."
else
  say "Starting openbox…"
  nohup openbox >"$LOG_DIR/openbox.log" 2>&1 &
  sleep 1
fi

# ----------------------------------------------------------------- x11vnc
if running "x11vnc.*:${VNC_PORT}"; then
  say "x11vnc already running."
else
  say "Starting x11vnc (loopback-only :${VNC_PORT})…"
  nohup x11vnc -display ":${DISPLAY_NUM}" -rfbport "${VNC_PORT}" \
    -localhost -shared -forever -nopw -ncache 10 -ncache_cr \
    >"$LOG_DIR/x11vnc.log" 2>&1 &
  sleep 1
fi

# ------------------------------------------------------------------ noVNC
if running "websockify.*${NOVNC_PORT}"; then
  say "noVNC already running."
else
  say "Starting noVNC (6080 -> 5900)…"
  if [ ! -d /usr/share/novnc ]; then
    echo "ERROR: /usr/share/novnc missing. Run scripts/daytona-vnc-setup.sh first."
    exit 1
  fi
  nohup websockify --web /usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" \
    >"$LOG_DIR/novnc.log" 2>&1 &
  sleep 1
fi

# ------------------------------------------------------------------ verify
for proc in "Xvfb :${DISPLAY_NUM}" "openbox" "x11vnc" "websockify"; do
  if ! running "$proc"; then
    echo "ERROR: '$proc' failed to start. Check $LOG_DIR for logs."
    exit 1
  fi
done

say "Desktop stack is up. Expose port ${NOVNC_PORT} in the Daytona dashboard,"
say "open it, click Connect — then the app below will appear there."
echo ""

# ---------------------------------------------------------------------- app
export ELECTRON_DISABLE_SANDBOX=1
export LIBGL_ALWAYS_SOFTWARE=1
if ! command -v bun >/dev/null 2>&1; then
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

say "Starting mausCode (dev mode). Ctrl+C stops the app; the VNC stack stays up."
exec bun run dev
