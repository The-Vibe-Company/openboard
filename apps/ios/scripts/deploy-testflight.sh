#!/usr/bin/env bash
set -euo pipefail

# Build, sign, export, and upload OpenBoard iOS to TestFlight using xcodegen + xcodebuild + asc.
# Usage:
#   ./apps/ios/scripts/deploy-testflight.sh [--ipa /path/to/OpenBoard.ipa] [--group "OpenBoard Internal"] [--tester email@example.com]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="${BUNDLE_ID:-co.thevibecompany.openboard}"
GROUP_NAME="${TESTFLIGHT_GROUP:-OpenBoard Internal}"
TESTER_EMAIL="${TESTFLIGHT_TESTER:-girard.stanislas@gmail.com}"
PREBUILT_IPA=""
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/build}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ipa) PREBUILT_IPA="$2"; shift 2 ;;
    --group) GROUP_NAME="$2"; shift 2 ;;
    --tester) TESTER_EMAIL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v asc >/dev/null 2>&1 || { echo "Missing asc CLI (https://asccli.sh)" >&2; exit 1; }

APP_ID="$(asc apps list --bundle-id "$BUNDLE_ID" --output json | python3 -c 'import json,sys; d=json.load(sys.stdin).get("data",[]); print(d[0]["id"] if d else "")')"
if [[ -z "$APP_ID" ]]; then
  echo "App record for $BUNDLE_ID not found in App Store Connect." >&2
  echo "Create it once at https://appstoreconnect.apple.com/apps (Bundle ID '$BUNDLE_ID' is already registered), then re-run this script." >&2
  exit 1
fi
echo "Found App Store Connect app ID: $APP_ID ($BUNDLE_ID)"

IPA_PATH="$PREBUILT_IPA"
if [[ -z "$IPA_PATH" ]]; then
  command -v xcodegen >/dev/null 2>&1 || { echo "Missing xcodegen (brew install xcodegen)" >&2; exit 1; }
  mkdir -p "$BUILD_DIR"

  VERSION="$(awk -F': ' '/MARKETING_VERSION:/ { gsub(/"/, "", $2); print $2; exit }' "$ROOT_DIR/project.yml")"
  NEXT_BUILD="$(asc builds next-build-number --app "$APP_ID" --version "$VERSION" --platform IOS --output json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("nextBuildNumber") or d.get("next") or "1")' || echo "1")"
  echo "Building OpenBoard $VERSION ($NEXT_BUILD)..."

  (cd "$ROOT_DIR" && xcodegen generate)

  ARCHIVE_PATH="$BUILD_DIR/OpenBoard.xcarchive"
  EXPORT_PATH="$BUILD_DIR/export"
  rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"

  xcodebuild \
    -project "$ROOT_DIR/OpenBoard.xcodeproj" \
    -scheme OpenBoard \
    -configuration Release \
    -destination "generic/platform=iOS" \
    CURRENT_PROJECT_VERSION="$NEXT_BUILD" \
    -archivePath "$ARCHIVE_PATH" \
    archive

  xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist "$ROOT_DIR/ExportOptions.plist"

  IPA_PATH="$EXPORT_PATH/OpenBoard.ipa"
fi

[[ -f "$IPA_PATH" ]] || { echo "IPA not found at $IPA_PATH" >&2; exit 1; }

echo "Uploading $IPA_PATH to TestFlight (app $APP_ID)..."
asc builds upload \
  --app "$APP_ID" \
  --ipa "$IPA_PATH" \
  --wait \
  --poll-interval 15s

BUILD_ID="$(asc builds latest --app "$APP_ID" --platform IOS --output json | python3 -c 'import json,sys; d=json.load(sys.stdin).get("data"); print(d["id"] if isinstance(d, dict) else (d[0]["id"] if d else ""))')"
if [[ -z "$BUILD_ID" ]]; then
  echo "Upload succeeded, but could not resolve latest build ID." >&2
  exit 1
fi
echo "Processed build ID: $BUILD_ID"

GROUP_ID="$(asc testflight groups list --app "$APP_ID" --output json | GROUP_NAME="$GROUP_NAME" python3 -c 'import json,sys,os; name=os.environ["GROUP_NAME"]; rows=json.load(sys.stdin).get("data",[]); match=[r["id"] for r in rows if r.get("attributes",{}).get("name")==name]; print(match[0] if match else "")')"
if [[ -z "$GROUP_ID" ]]; then
  echo "Creating internal TestFlight group '$GROUP_NAME'..."
  GROUP_ID="$(asc testflight groups create --app "$APP_ID" --name "$GROUP_NAME" --internal --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')"
fi

if [[ -n "$TESTER_EMAIL" ]]; then
  asc testflight testers add --app "$APP_ID" --email "$TESTER_EMAIL" --group "$GROUP_ID" >/dev/null 2>&1 || true
fi

asc builds add-groups --build "$BUILD_ID" --group "$GROUP_ID"
echo "OpenBoard build $BUILD_ID is live in TestFlight group '$GROUP_NAME'!"
