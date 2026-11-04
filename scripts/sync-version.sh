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
  sed -i -E "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$ROOT_DIR/frontend/package.json"
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
  sed -i -E "s/\\bVersion=\"[0-9]+(\\.[0-9]+){1,3}\"/Version=\"$MSIX_VERSION\"/g" "$MSIX_APP_MANIFEST"
  echo "  [✓] Updated build/windows/msix/app_manifest.xml -> $MSIX_VERSION"
fi

if [ -f "$MSIX_TEMPLATE" ]; then
  sed -i -E "s/\\bVersion=\"[0-9]+(\\.[0-9]+){1,3}\"/Version=\"$MSIX_VERSION\"/g" "$MSIX_TEMPLATE"
  echo "  [✓] Updated build/windows/msix/template.xml -> $MSIX_VERSION"
fi

echo "==> Version sync complete ($VERSION)."

