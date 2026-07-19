#!/usr/bin/env bash
# Noted release — local build, sign, notarize, and verify the staple.
#
# Apple credentials (APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD) are
# read from .env.local (gitignored) so they never touch the repo or CI. Point at
# a different file with APPLE_CREDS_ENV=/path/to/creds.env.
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Load credentials ──────────────────────────────────────────────────────
CREDS="${APPLE_CREDS_ENV:-.env.local}"
if [[ -f "$CREDS" ]]; then
  echo "→ Loading Apple credentials from $CREDS"
  set -a
  # shellcheck disable=SC1090
  source "$CREDS"
  set +a
else
  echo "→ No $CREDS found; relying on the environment"
fi

for v in APPLE_ID APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD; do
  if [[ -z "${!v:-}" ]]; then
    echo "✗ Missing $v — set it in .env.local (copy from .env.local.example) or the environment." >&2
    exit 1
  fi
done
echo "✓ Apple credentials present (APPLE_ID=$APPLE_ID, TEAM=$APPLE_TEAM_ID)"

# ── Build + sign + notarize (electron-builder staples on success) ─────────
npm run build

# ── Verify the notarization ticket is stapled to each artifact ────────────
echo
echo "── Verifying notarization ──"
shopt -s nullglob
for dmg in release/*.dmg; do
  echo "== $dmg =="
  xcrun stapler validate "$dmg" && echo "  ✓ stapled" || echo "  ✗ staple missing"
done
echo "Done."
