#!/usr/bin/env bash
# Push the store-release credentials from your local .env into this repo's GitHub
# Actions secrets, so .github/workflows/release.yml can publish. Values go
# straight from your machine to GitHub via `gh` — they are never printed.
#
# Prerequisites:
#   - gh CLI authenticated:  gh auth login
#   - a filled-in .env       (copy .env.example → .env)
#
# Usage:
#   ./scripts/gh-secrets-sync.sh            # set secrets on the current repo
#   ./scripts/gh-secrets-sync.sh owner/repo # or target an explicit repo
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_ARG=()
if [ "${1:-}" != "" ]; then
  REPO_ARG=(--repo "$1")
fi

if [ ! -f .env ]; then
  echo "✗ No .env found. Copy .env.example → .env and fill in your store creds." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "✗ The GitHub CLI (gh) is not installed. See https://cli.github.com/" >&2
  exit 1
fi

# Secrets consumed by .github/workflows/release.yml. EDGE_CERT_NOTES is optional
# (Edge certification notes); the rest gate their store's publish step.
KEYS=(
  CHROME_EXTENSION_ID
  CHROME_CLIENT_ID
  CHROME_CLIENT_SECRET
  CHROME_REFRESH_TOKEN
  EDGE_PRODUCT_ID
  EDGE_CLIENT_ID
  EDGE_API_KEY
  EDGE_CERT_NOTES
)

# Load .env without echoing anything.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

set_count=0
for k in "${KEYS[@]}"; do
  v="${!k:-}"
  if [ -n "$v" ]; then
    printf '%s' "$v" | gh secret set "$k" "${REPO_ARG[@]}" --body - >/dev/null
    echo "  ✓ set $k"
    set_count=$((set_count + 1))
  else
    echo "  – skip $k (empty in .env)"
  fi
done

echo ""
echo "Done — $set_count secret(s) set. Push a tag to build a draft, e.g.:"
echo "  git tag v1.11.0 && git push origin v1.11.0"
echo "Then submit for review: Actions → Release → Run workflow → publish = true."
