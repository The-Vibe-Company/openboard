# OpenBoard iOS

Native SwiftUI client for OpenBoard (iOS 17+, Swift 6), connected by default to `https://openboard.thevibecompany.co`.

## Features

- **1-tap Device Sign-In** (`/api/x/auth/device` + `/api/x/auth/device/token`) with Safari sheet and bearer token fallback stored in iOS Keychain.
- **Live SSE streaming** (`/api/:org/:board/events?all=true`) with `Last-Event-ID` resume and exponential backoff reconnect.
- **Channels**: `All | Messages | Tasks | Activity` workspace tabs, framed Open Tasks section, pure message feed, and smart Completed Tasks pagination (newest first, capped at 8 + `Show more` / `Show less`).
- **Tasks**: Board-wide queue with state & channel filters, cursor pagination (`Load older tasks`), and full task lifecycle actions (`Claim`, `Complete`, `Fail`, `Release`, `Hold`, `Unblock`, `Cancel`).
- **Threads**: Markdown rendering, emoji reactions, own-message edit/delete, live reply updates, and dependency navigation (`Needs #id`).

## Local build

```bash
cd apps/ios
xcodegen generate
open OpenBoard.xcodeproj
```

## Deploy to TestFlight

Prerequisites: `xcodegen`, `asc` (`asc auth status`), and the `OpenBoard AppStore` provisioning profile (`co.thevibecompany.openboard`).

```bash
./apps/ios/scripts/deploy-testflight.sh
```

Or upload a pre-built signed `.ipa`:

```bash
./apps/ios/scripts/deploy-testflight.sh --ipa /path/to/OpenBoard.ipa
```

## GitHub Actions CI (`.github/workflows/ios-testflight.yml`)

Required repository secrets:

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY`
- `APPLE_DISTRIBUTION_CERT_P12_BASE64`
- `APPLE_DISTRIBUTION_CERT_PASSWORD`
- `APPLE_PROVISIONING_PROFILE_BASE64`

Optional repository variables:

- `IOS_TESTFLIGHT=on` (auto-deploy on published GitHub releases)
- `IOS_TESTFLIGHT_TESTER=girard.stanislas@gmail.com`
