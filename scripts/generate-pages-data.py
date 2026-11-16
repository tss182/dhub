#!/usr/bin/env python3
"""Fetch latest GitHub Releases and write static JSON + version tags for GitHub Pages."""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
PAGES_DIR = ROOT_DIR / "pages"
RELEASES_JSON = PAGES_DIR / "releases.json"
INDEX_HTML = PAGES_DIR / "index.html"

REPO = os.environ.get("GITHUB_REPOSITORY", "tss182/dhub")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
API_URL = f"https://api.github.com/repos/{REPO}/releases?per_page=5"


def fetch_releases():
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "dhub-pages-builder",
    }
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"

    req = urllib.request.Request(API_URL, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    # Keep only non-draft releases, up to 5
    releases = [r for r in data if not r.get("draft")][:5]
    trimmed = []
    for r in releases:
        trimmed.append(
            {
                "tag_name": r.get("tag_name", ""),
                "name": r.get("name", ""),
                "published_at": r.get("published_at", ""),
                "html_url": r.get("html_url", ""),
                "prerelease": bool(r.get("prerelease", False)),
                "body": r.get("body", ""),
                "assets": [
                    {
                        "name": a.get("name", ""),
                        "size": a.get("size", 0),
                        "browser_download_url": a.get("browser_download_url", ""),
                    }
                    for a in r.get("assets", [])
                ],
            }
        )
    return trimmed


def update_index_html(latest_tag: str):
    if not latest_tag or not INDEX_HTML.exists():
        return
    html = INDEX_HTML.read_text(encoding="utf-8")
    html = re.sub(
        r'(<span[^>]*id="nav-version-pill"[^>]*>)[^<]*(</span>)',
        rf"\g<1>{latest_tag}\g<2>",
        html,
        count=1,
    )
    html = re.sub(
        r'(<span[^>]*id="hero-badge-text"[^>]*>)[^<]*(</span>)',
        rf"\g<1>Latest Release {latest_tag}\g<2>",
        html,
        count=1,
    )
    INDEX_HTML.write_text(html, encoding="utf-8")


def main():
    try:
        releases = fetch_releases()
    except Exception as exc:
        print(f"Warning: could not fetch releases from GitHub API: {exc}", file=sys.stderr)
        return 0

    if not releases:
        print("Warning: no releases returned from GitHub API.", file=sys.stderr)
        return 0

    RELEASES_JSON.write_text(json.dumps(releases, indent=2) + "\n", encoding="utf-8")
    latest_tag = releases[0].get("tag_name", "")
    update_index_html(latest_tag)
    print(f"Generated {RELEASES_JSON} with {len(releases)} release(s) (latest: {latest_tag}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
