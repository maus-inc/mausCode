# Run mausCode's Desktop GUI in Daytona over VNC (from scratch)

This guide takes you from a machine with nothing installed to clicking around the
real mausCode Electron app in your browser, running on a Daytona sandbox.

## How it fits together

```text
Your browser ──► Daytona port forward ──► noVNC (:6080) ──► x11vnc (:5900)
                                                              │
                                              Xvfb virtual display (:99)
                                              openbox window manager
                                              mausCode Electron app
```

Everything below the browser runs inside one Daytona sandbox. NoVNC turns the
VNC stream into a web page, so you need zero VNC client software — just a browser.

> CLI drift note: Daytona's CLI flags change between releases. Anything below that
> depends on exact flags tells you the `--help` command to confirm. The dashboard
> path always works regardless of CLI version.

## Step 0 — Size the sandbox correctly

Electron + a dev server wants real resources. Minimum that feels OK:

- 4 vCPU / 8 GB RAM / 30 GB disk.

`bun install` + first dev boot downloads ~1 GB (deps + Electron binary). A 2 GB
sandbox will OOM during install — don't use one.

## Step 1 — Scratch machine: install the Daytona CLI

Pick your machine's OS. You need a Daytona account (https://www.daytona.io —
create one first if you haven't).

**macOS:**

```bash
brew install daytona
```

**Linux:**

```bash
curl -sfL https://download.daytona.io/daytona/install.sh | sudo bash
```

**Windows (PowerShell, admin):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb https://download.daytona.io/daytona/install.ps1 | iex"
```

Then log in and verify:

```bash
daytona login
daytona --version
```

`daytona login` opens a browser tab to connect the CLI to your account.

## Step 2 — Create the sandbox

Interactive (recommended — version-proof, it walks you through image and size):

```bash
daytona create --name mauscode-vnc
```

- Image: default Ubuntu image is fine.
- Resources: 4 CPU / 8 GB RAM / 30 GB disk (see Step 0).

Non-interactive, if your CLI version supports the flags (check
`daytona create --help` first):

```bash
daytona create --name mauscode-vnc --cpu 4 --memory 8 --disk 30
```

Open a shell on it:

```bash
daytona ssh mauscode-vnc
```

Keep this shell open — everything from here runs inside it.

## Step 3 — One-shot setup (inside the sandbox)

Clone the repo and run the setup script (it installs system libraries, Node 22,
Bun, Xvfb, a window manager, x11vnc, noVNC, and the project's dependencies):

```bash
git clone https://github.com/maus-inc/mausCode.git
cd mausCode
git checkout arena/01a08de4-mauscode   # or main, or whichever branch you want
bash scripts/daytona-vnc-setup.sh
```

This takes 5–15 minutes on first run (mostly downloads). It is safe to re-run —
steps it already completed are skipped.

What it installs and why:

| Thing | Why |
|---|---|
| `xvfb`, `x11vnc`, `openbox` | Virtual display + VNC server + window manager |
| `novnc`, `websockify` | Serves the desktop as a web page on port 6080 |
| `libnss3`, `libatk*`, `libcups2`, `libdrm2`, `libgbm1`, `libasound2`, … | System libraries Electron needs on Linux |
| Node 22, Bun | The repo's toolchain (`bun.lock` + `electron-vite`) |
| `bun install` output | Project dependencies (run once here, not on every boot) |

## Step 4 — Start the desktop stack + the app (inside the sandbox)

```bash
bash scripts/daytona-vnc-start.sh
```

This starts, in order: Xvfb (display `:99`, 1600×900), openbox, x11vnc
(loopback-only on 5900), noVNC (port 6080 → 5900), then the app itself with:

```bash
DISPLAY=:99 ELECTRON_DISABLE_SANDBOX=1 LIBGL_ALWAYS_SOFTWARE=1 bun run dev
```

Why those variables:

- `DISPLAY=:99` — Electron draws to the virtual display instead of failing on
  "no display".
- `ELECTRON_DISABLE_SANDBOX=1` — containers almost always lack the user
  namespaces Chrome's sandbox needs. Without this the app exits immediately
  with a sandbox error. (Safe here: it's your own sandbox, not a browser
  facing the web.)
- `LIBGL_ALWAYS_SOFTWARE=1` — software 3D rendering (llvmpipe). No GPU in the
  sandbox; this stops Electron from crashing while probing for one.

Leave this shell running — the app's logs and hot-reload output appear here.
`Ctrl+C` stops the app; the desktop stack keeps running so you can relaunch
without redoing VNC.

## Step 5 — Open the desktop in your browser

1. Open the Daytona dashboard → your `mauscode-vnc` sandbox → **Ports**.
2. Add / expose port **6080** and open its public URL.
3. You'll see the noVNC page. Click **Connect**.
4. The Ubuntu desktop appears; the mausCode window opens once the dev server
   finishes booting (~30–60 s first time).

Tips for a good session:

- noVNC settings (gear icon, left toolbar): set **Scaling Mode → Local Scaling**
  so the desktop fits your browser tab.
- Clipboard sync works through the noVNC toolbar clipboard panel.
- There is no audio forwarding. Anything that plays sound stays silent.

## Step 6 — Daily use

```bash
daytona ssh mauscode-vnc          # get back in
cd mausCode
bash scripts/daytona-vnc-start.sh # desktop stack + app, one command
```

Useful lifecycle commands (confirm exact spelling with `--help` on your CLI):

```bash
daytona list                      # see your sandboxes
daytona stop mauscode-vnc         # park it (stops billing compute)
daytona start mauscode-vnc        # resume it
daytona delete mauscode-vnc       # tear it down for good
```

To skip Step 3 forever, take a snapshot after a successful setup
(dashboard → sandbox → Snapshots, or `daytona snapshot --help`) and create
future sandboxes from it. Then it's just: create from snapshot → start script →
open port 6080.

## Running the packaged app instead of dev mode

Dev mode (`bun run dev`) is best for iterating. To test the real shipped Linux
build over VNC instead:

```bash
# inside the sandbox, app NOT running
bun run package:linux
DISPLAY=:99 ./release/*.AppImage --no-sandbox
```

(Exact artifact name depends on the electron-builder config; look under
`release/` after packaging.)

## Troubleshooting

**App exits instantly with `Running as root without --no-sandbox is not supported`,
or any `sandbox` / `zygote` error.**
You lost the env var. Make sure you start the app through
`scripts/daytona-vnc-start.sh`, which sets `ELECTRON_DISABLE_SANDBOX=1`.

**`Unable to open X display` / `Missing X server`.**
`DISPLAY` isn't set or Xvfb died. Re-run the start script; it boots Xvfb first
and refuses to launch the app if the display isn't up.

**Black window / GPU process crashes / `GLib-GObject` criticals.**
Software rendering fallback didn't engage. Confirm `LIBGL_ALWAYS_SOFTWARE=1`
is set (the start script sets it) and that `mesa-utils`/DRI libs installed
(the setup script installs them; check `glxinfo -B` shows `llvmpipe`).

**noVNC page loads but stays black.**
x11vnc isn't attached to the display. Inside the sandbox:
`pgrep -a Xvfb; pgrep -a x11vnc` — both must be running. Re-run the start
script if either is missing.

**Everything is sluggish.**
Lower the resolution: edit `VNC_GEOMETRY` in `scripts/daytona-vnc-start.sh`
(e.g. `1280x720`) and restart the stack. Dev-mode first paint is always slow;
after that, interactions should feel near-local on a 4-CPU box.

**Port 6080 URL shows nothing / connection refused.**
The sandbox firewall or the forward isn't set. Re-check dashboard → Ports →
6080 is exposed, and `ss -ltn | grep 6080` inside the sandbox shows
websockify listening.

**`bun install` OOMs or the machine crawls during install.**
Sandbox is too small. Recreate with 8 GB RAM (Step 0). There is no
configuration that makes 2 GB work for this repo.

**Fonts look wrong / boxes instead of glyphs.**
Install a fallback set: `sudo apt-get install -y fonts-noto fonts-noto-color-emoji`
then restart the app.

## Files in this repo

- `scripts/daytona-vnc-setup.sh` — one-shot provisioning (Step 3).
- `scripts/daytona-vnc-start.sh` — boots the desktop stack + app (Step 4).
- This guide — `docs/daytona-vnc-from-scratch.md`.
