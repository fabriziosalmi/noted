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

# ── Build + sign (electron-builder signs with the Developer ID + hardened runtime) ──
npm run build

# ── Notarize + staple each DMG ────────────────────────────────────────────
# electron-builder signs the .app but does not notarize the DMG file itself, so
# submit each DMG to Apple and staple the ticket — otherwise the downloaded DMG
# fails offline Gatekeeper validation. Scoped to this build's version so old
# artifacts in release/ aren't re-submitted.
VERSION="$(node -p "require('./package.json').version")"
echo
echo "── Notarizing + stapling DMGs (v$VERSION) ──"
shopt -s nullglob
found=0
for dmg in "release/Noted-$VERSION"*.dmg; do
  found=1
  echo "== $dmg =="
  xcrun notarytool submit "$dmg" \
    --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --wait
  xcrun stapler staple "$dmg" && echo "  ✓ stapled" || { echo "  ✗ staple failed" >&2; exit 1; }
done
[[ "$found" == 1 ]] || { echo "✗ no release/Noted-$VERSION*.dmg found" >&2; exit 1; }
echo "Done — v$VERSION DMGs signed, notarized, stapled."

# ── Publish checklist ─────────────────────────────────────────────────────
# electron-updater discovers new versions by fetching latest-mac.yml from the
# release assets. Ship the DMGs without it and every existing install stays on
# its current version forever, silently — so refuse to print a green light when
# the metadata is missing.
echo
echo "── Upload these assets to the GitHub release ──"
YML="release/latest-mac.yml"
if [[ ! -f "$YML" ]]; then
  echo "✗ $YML is missing — auto-update needs it." >&2
  echo "  It is generated when build.publish is set in package.json; re-run 'npm run build'." >&2
  exit 1
fi
ASSETS=("$YML")
for f in "release/Noted-$VERSION"*.dmg; do ASSETS+=("$f"); done
printf '  %s\n' "${ASSETS[@]}"
echo
echo "  gh release create v$VERSION ${ASSETS[*]} \\"
echo "    --title 'Noted $VERSION' --notes-file <notes.md>"
echo
echo "  (add --draft first if you want to eyeball it before it goes public)"
