#!/usr/bin/env bash
set -euo pipefail

# Find project root (directory containing this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_FILE="$ROOT_DIR/build/config.yml"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: $CONFIG_FILE not found." >&2
  exit 1
fi

# Extract version from info.version in build/config.yml
VERSION=$(sed -n '/^info:/,/^[a-zA-Z]/p' "$CONFIG_FILE" | grep -E '^[[:space:]]*version:' | head -n 1 | sed -E 's/.*version:[[:space:]]*["'"'"']?([^"'"'"'#[:space:]]+).*/\1/')

if [ -z "$VERSION" ]; then
  echo "Error: Could not extract version from $CONFIG_FILE" >&2
  exit 1
fi

echo "==> Found version in build/config.yml: $VERSION"

# Portable in-place sed using ERE (-E) for both GNU sed (Linux) and BSD sed (macOS)
sed_inplace() {
  local expr="$1"
  local file="$2"
  local tmp
  tmp="$(mktemp)"
  if sed -E "$expr" "$file" > "$tmp"; then
    cat "$tmp" > "$file"
    rm -f "$tmp"
  else
    rm -f "$tmp"
    return 1
  fi
}

# 1. Update frontend/src/version.ts
VERSION_TS="$ROOT_DIR/frontend/src/version.ts"
mkdir -p "$(dirname "$VERSION_TS")"
echo "export const APP_VERSION = '$VERSION';" > "$VERSION_TS"
echo "  [✓] Updated frontend/src/version.ts -> $VERSION"

# 2. Update frontend/package.json and package-lock.json
if command -v npm >/dev/null 2>&1; then
  npm --prefix "$ROOT_DIR/frontend" version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null 2>&1 || true
  echo "  [✓] Updated frontend/package.json & package-lock.json -> $VERSION"
else
  # Fallback to sed if npm is not installed
  sed_inplace "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$ROOT_DIR/frontend/package.json"
  echo "  [✓] Updated frontend/package.json (via sed) -> $VERSION"
fi

# 3. Update build/windows/msix manifests (requires 4-part version: X.Y.Z.0)
IFS='.' read -r -a PARTS <<< "$VERSION"
while [ "${#PARTS[@]}" -lt 4 ]; do
  PARTS+=(0)
done
MSIX_VERSION="${PARTS[0]}.${PARTS[1]}.${PARTS[2]}.${PARTS[3]}"

MSIX_APP_MANIFEST="$ROOT_DIR/build/windows/msix/app_manifest.xml"
MSIX_TEMPLATE="$ROOT_DIR/build/windows/msix/template.xml"

if [ -f "$MSIX_APP_MANIFEST" ]; then
  sed_inplace "s/([[:space:]])Version=\"[0-9]+(\.[0-9]+){1,3}\"/\1Version=\"$MSIX_VERSION\"/g" "$MSIX_APP_MANIFEST"
  echo "  [✓] Updated build/windows/msix/app_manifest.xml -> $MSIX_VERSION"
fi

if [ -f "$MSIX_TEMPLATE" ]; then
  sed_inplace "s/([[:space:]])Version=\"[0-9]+(\.[0-9]+){1,3}\"/\1Version=\"$MSIX_VERSION\"/g" "$MSIX_TEMPLATE"
  echo "  [✓] Updated build/windows/msix/template.xml -> $MSIX_VERSION"
fi

# 4. Update internal/version/version.go
VERSION_GO="$ROOT_DIR/internal/version/version.go"
mkdir -p "$(dirname "$VERSION_GO")"
cat <<EOF > "$VERSION_GO"
package version

// CurrentVersion defines the running application version
const CurrentVersion = "$VERSION"
EOF
echo "  [✓] Updated internal/version/version.go -> $VERSION"

# 5. Update README.md version badge and latest version text
README_FILE="$ROOT_DIR/README.md"
if [ -f "$README_FILE" ]; then
  sed_inplace "s/version-v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?-blue\.svg/version-v$VERSION-blue.svg/g" "$README_FILE"
  sed_inplace "s/\(\*\*v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\*\*\)/(**v$VERSION**)/g" "$README_FILE"
  echo "  [✓] Updated README.md -> v$VERSION"
fi

# 6. Update pages/index.html fallback version pill
PAGES_HTML="$ROOT_DIR/pages/index.html"
if [ -f "$PAGES_HTML" ]; then
  sed_inplace "s/(id=\"nav-version-pill\">)v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(<)/\1v$VERSION\3/g" "$PAGES_HTML"
  echo "  [✓] Updated pages/index.html -> v$VERSION"
fi

echo "==> Version sync complete ($VERSION)."

