#!/usr/bin/env bash
# One-shot provisioning for running mausCode's Electron GUI over VNC/noVNC
# inside a Daytona Ubuntu sandbox. Safe to re-run; completed steps are skipped.
# Usage (inside the sandbox, from the repo root):
#   bash scripts/daytona-vnc-setup.sh
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say() { echo "==> $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- apt packages
say "Installing system packages (VNC stack + Electron libraries)…"
sudo apt-get update -y
# Installed one-by-one with `|| true`: package names differ slightly between
# Ubuntu releases (e.g. libatk t64 renames on 24.04) and one miss must not
# abort the whole setup. Missing-but-needed libs surface loudly at app boot.
APT_PKGS=(
  xvfb x11vnc openbox novnc websockify
  curl git unzip ca-certificates
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
  libpango-1.0-0 libcairo2 libatspi2.0-0 libx11-xcb1 libxcursor1
  mesa-utils libgl1-mesa-dri
  fonts-noto fonts-noto-color-emoji
)
for pkg in "${APT_PKGS[@]}"; do
  if dpkg -s "$pkg" >/dev/null 2>&1; then
    echo "    [ok] $pkg"
  else
    sudo apt-get install -y "$pkg" || echo "    [skip] $pkg (not available on this Ubuntu)"
  fi
done

# ------------------------------------------------------------------- Node 22
if have node && node --version | grep -qE "^v(20|22|23|24)\."; then
  say "Node $(node --version) already present."
else
  say "Installing Node 22 (nodesource)…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# ------------------------------------------------------------------------ Bun
if have bun; then
  say "Bun $(bun --version) already present."
else
  say "Installing Bun…"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
if ! have bun; then
  # shellcheck disable=SC1090
  [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" >/dev/null 2>&1 || true
fi
have bun || { echo "ERROR: bun install did not land on PATH. Open a new shell and re-run."; exit 1; }
say "Bun $(bun --version) ready."

# ----------------------------------------------------------------- preinstall
if [ ! -f "package.json" ]; then
  echo "ERROR: run this from the mausCode repo root (package.json not found)."
  exit 1
fi

# ------------------------------------------------------------- dependencies
say "Installing project dependencies (bun install)…"
bun install

# ------------------------------------------------------------- sanity checks
say "Sanity checks…"
have Xvfb || echo "WARN: Xvfb missing — VNC stack install failed, see above."
have x11vnc || echo "WARN: x11vnc missing — VNC stack install failed, see above."
[ -d /usr/share/novnc ] || echo "WARN: /usr/share/novnc missing — noVNC package absent."
[ -d node_modules/electron ] || echo "WARN: node_modules/electron missing — bun install incomplete."

say "Setup complete. Start everything with:  bash scripts/daytona-vnc-start.sh"
