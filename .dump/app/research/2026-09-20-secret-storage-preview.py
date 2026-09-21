"""Serve only the step 11 comparison and its four local font files."""

import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
PAGE = "/.dump/app/research/2026-09-20-secret-storage-options.html"
FONTS = {
    "/src/renderer/assets/fonts/" + name
    for name in [
        "NeueHaasDisplayRoman.ttf",
        "NeueHaasDisplayMediu.ttf",
        "geist-pixel-circle-regular.ttf",
        "pathway-extreme-latin-100-normal.ttf",
    ]
}


class Preview(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", PAGE)
            self.end_headers()
            return
        if path != PAGE and path not in FONTS:
            self.send_error(404)
            return
        content = (ROOT / path.lstrip("/")).read_bytes()
        self.send_response(200)
        self.send_header(
            "Content-Type", "text/html; charset=utf-8" if path == PAGE else "font/ttf"
        )
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    # Loopback by default: this serves a credential-storage prototype and needs
    # no network access. PREVIEW_HOST exists only for a container preview proxy.
    host = os.environ.get("PREVIEW_HOST", "127.0.0.1")
    HTTPServer((host, 4173), Preview).serve_forever()
