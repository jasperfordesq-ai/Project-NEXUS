# Project NEXUS Mobile — Security Guide

Last reviewed: 2026-07-30

This document describes the mobile app's security posture, identifies known gaps, and provides implementation guidance for hardening.

---

## 1. Current Security Posture

### What is already in place

| Area | Implementation | Where |
|------|---------------|-------|
| **Secure token storage** | `expo-secure-store` (Keychain on iOS, EncryptedSharedPreferences on Android) | `lib/storage.ts` |
| **HTTPS enforcement** | `EXPO_PUBLIC_API_URL` always uses `https://` in production | `.env.example`, `lib/env.ts` |
| **Tenant isolation** | Every API request includes the tenant slug; backend enforces row-level isolation | `lib/api/` |
| **401 refresh + auto-logout** | Fetch client attempts one refresh-token rotation, retries the original request, then clears credentials and redirects to login if refresh fails | `lib/api/client.ts`, `lib/context/AuthContext.tsx` |
| **Rate limit awareness** | Non-2xx API responses, including 429, are surfaced through typed `ApiResponseError` objects | `lib/api/client.ts` |
| **No secrets in code** | All credentials come from `EXPO_PUBLIC_*` env vars; `.env.local` is gitignored | `.gitignore` |
| **Auth input validation** | Zod schemas validate login, registration, forgot-password, and reset-password forms before submission | `app/(auth)/*.tsx` |
| **Android certificate pinning** | A project config plugin copies the fail-closed network security policy into generated Android builds and wires it into the manifest | `plugins/with-android-network-security.js`, `android-network-security-config.xml`, `scripts/verify-release-config.mjs` |

### Known gaps / future hardening

- iOS uses ATS HTTPS enforcement but does not yet enforce strict SHA-256 certificate pinning (see Section 2)
- Play Integrity / App Attest server-backed attestation is not yet implemented (see Section 3)
- Extend schema validation beyond auth forms where native forms accept high-risk input

---

## 2. Certificate Pinning

Certificate pinning prevents MITM (man-in-the-middle) attacks by refusing TLS connections to any certificate not explicitly trusted — even if it chains to a trusted root CA.

### Current implementation

Android pinning is implemented for `api.project-nexus.ie` by the project config
plugin `plugins/with-android-network-security.js`. During Expo prebuild it:

1. Sets `android:networkSecurityConfig="@xml/network_security_config"` and
   `android:usesCleartextTraffic="false"` on the application manifest.
2. Copies the canonical `android-network-security-config.xml` into the generated
   `android/app/src/main/res/xml/network_security_config.xml`.

The source policy pins the live leaf SPKI plus a rotation-safe intermediate
SPKI, blocks cleartext traffic in both the domain and base configurations, and
does not trust user-added certificate authorities. `lib/security/pinning.ts` is
only a JavaScript host/configuration helper; Android enforcement is native and
does not depend on a runtime JS interceptor. The generated `mobile/android/`
directory is gitignored and is not the source of truth.

iOS currently relies on App Transport Security (ATS) HTTPS enforcement. Strict iOS SHA-256 certificate pinning still requires TrustKit or a similar native module in a prebuild/bare workflow.

### How to maintain Android pinning

Run these commands from `mobile/`.

**Step 1 - Keep the project plugin configured:**

```json
{
  "expo": {
    "plugins": [
      "./plugins/with-android-network-security",
      [
        "expo-build-properties",
        {
          "android": {
            "useLegacyPackaging": true
          }
        }
      ]
    ]
  }
}
```

`expo-build-properties` remains installed for packaging/framework settings, but
it does **not** inject this network security file. Keep the custom plugin as a
separate `app.json` entry.

**Step 2 - Refresh the canonical pins before certificate rotation or expiry:**

```bash
bash scripts/get-cert-pins.sh api.project-nexus.ie 443
```

Then check the declared pins against what the server actually serves:

```bash
npm run check:cert-pins
```

🔴 **Pin the INTERMEDIATE and the ROOT, not the leaf** (changed 2026-08-20). This
reverses the previous instruction, and the reason is measured rather than
theoretical.

The leaf certificate has a **90-day lifetime** and rotates automatically
(measured: notBefore 2026-08-10, notAfter 2026-11-08). Pinning it therefore
guarantees the pin goes stale roughly four times a year — and it had: the config
said "Pins last verified: 2026-07-14" while the pinned leaf matched **nothing** in
the live chain, five weeks out of date, with every gate green.

The app kept working only because Android trusts a chain when ANY certificate in it
matches ANY pin, so the intermediate backup carried it alone. That left it **one
pin deep with no spare**, which is the state that bricks an app the moment a CA
rotates.

The leaf pin was also buying nothing. With the intermediate pinned, the effective
constraint is already "a certificate issued by GTS WE1"; the leaf narrows nothing
while guaranteeing quarterly staleness and inviting false confidence in a
"last verified" date.

So: keep at least two SHA-256 pins **at different chain depths** — the GTS WE1
intermediate (notAfter 2029-02-20) and the GTS Root R4 — and move the `pin-set`
expiration far enough ahead for the release gate's 90-day minimum. Never add a
TrustKit element: Android Network Security Configuration does not support it.

**What each check does and does not cover**, since the gap between them is how the
stale pin survived:

| Check | Covers | Does NOT cover |
| --- | --- | --- |
| `verify:network-security` | pinning exists, cleartext refused | whether the pins are correct |
| `verify:release` | pin-set expiry >90 days, ≥2 pins | whether the pins match anything |
| `check:cert-pins` | pins match the LIVE chain, at ≥2 depths | anything offline |
| `lib/security/certificatePinning.test.ts` | the retired leaf is not re-added; source and generated agree | the live chain |

`check:cert-pins` is deliberately **not** in the blocking CI path: it makes a real
TLS connection, so a network blip would redden a release gate and teach everyone to
ignore it. Run it by hand after a certificate change, and from the nightly sweep.
It exits **2** for "could not check" — never 0 — so an unreachable host can never
read as a pass.

**Step 3 - Run the source-level release gate:**

```bash
npm run verify:release
```

`scripts/verify-release-config.mjs` blocks a release when app/package versions
drift, `versionCode` is not an integer greater than 1, OTA/runtime channels are
unsafe, the custom network plugin is absent, fewer than two pins exist, pin
expiry is within 90 days, an unsupported TrustKit element appears, or Android
app links include an untrusted host.

**Step 4 - Generate and inspect the native policy:**

```bash
npx expo prebuild --platform android --no-install --clean
```

Confirm that the generated manifest contains both application attributes, that
`android/app/src/main/res/xml/network_security_config.xml` exists, and that it
contains the exact `api.project-nexus.ie` domain plus SHA-256 pins. CI's
**Android Native Release Gate** performs this clean prebuild and inspection in
addition to `npm run verify:release`, mobile type-check/tests, and
`expo-doctor`.

**Step 5 - iOS ATS (App Transport Security):**

iOS enforces HTTPS by default via ATS. To add certificate pinning on iOS you need a bare workflow or a custom native module. For managed workflow, ATS ensures HTTPS but cannot pin specific certificates. Options:

- Use `react-native-ssl-pinning` (requires bare/prebuild workflow)
- Or rely on ATS + your CA chain for managed workflow

**Important — pin rotation:**

- Always include at least two pins, **at different chain depths** (intermediate + root).
  Two pins on the same certificate are one pin.
- **Do not pin a short-lived leaf.** It rotates every ~90 days and adds no constraint
  that the intermediate pin does not already impose.
- Set an `expiration` date and rotate while more than 90 days remain. Note it is a
  FAIL-OPEN valve: past that date Android stops enforcing pinning altogether, so the
  app keeps working but silently loses the protection.
- Ship a new native Android binary after changing pins; an OTA JavaScript update cannot replace the packaged network security XML
- A failed pin with no backup = the app cannot connect to the API

---

## 3. App Integrity Checking

App integrity attestation lets the backend verify that requests come from an unmodified, genuine copy of the app — not a rooted device, an emulator, or a repackaged APK.

### When this matters

- When you want to prevent abuse of the API from modified clients
- When regulatory requirements mandate attestation (e.g., financial services)
- When implementing anti-bot measures for registration/login

### Android — Play Integrity API

Google Play Integrity API replaces the deprecated SafetyNet.

**High-level flow:**

1. Backend generates a nonce and sends it to the mobile app
2. App calls `IntegrityManager.requestIntegrityToken(nonce)`
3. App sends the token to the backend
4. Backend verifies the token with Google's servers (server-to-server call)
5. Backend checks `deviceIntegrity`, `appIntegrity`, and `accountDetails` claims

**Adding to the app (bare/prebuild workflow):**

```bash
# Install the community module
npm install react-native-google-play-integrity
```

```typescript
import { checkPlayIntegrity } from 'react-native-google-play-integrity';

async function getIntegrityToken(nonce: string): Promise<string> {
  const result = await checkPlayIntegrity({
    nonce,
    cloudProjectNumber: process.env.EXPO_PUBLIC_GCP_PROJECT_NUMBER!,
  });
  return result.token;
}
```

**Backend verification** — POST to `https://playintegrity.googleapis.com/v1/{package}:decodeIntegrityToken` with the token using a service account.

### iOS — DeviceCheck / App Attest

Apple's App Attest (iOS 14+) is more robust than DeviceCheck.

**High-level flow:**

1. Backend generates a challenge
2. App calls `DCAppAttestService.shared.attestKey(keyId, clientDataHash: challenge)`
3. App sends the attestation object to the backend
4. Backend verifies with Apple's servers
5. On subsequent requests, app generates assertions with `generateAssertion`

**Adding to the app (bare/prebuild workflow):**

```typescript
import { NativeModules } from 'react-native';
// Use react-native-ios-appattest or a custom native module
const { AppAttest } = NativeModules;

async function attestDevice(challenge: string): Promise<string> {
  const keyId = await AppAttest.generateKey();
  const attestation = await AppAttest.attest(keyId, challenge);
  return attestation;
}
```

**Managed workflow limitation:** Both Play Integrity and App Attest require native code. You must use `expo prebuild` (bare workflow) or an EAS custom development client.

---

## 4. Sensitive Data Handling

### Secure storage — what goes where

| Data | Storage | Reason |
|------|---------|--------|
| Access token | `expo-secure-store` | Encrypted at rest, hardware-backed on supported devices |
| Refresh token | `expo-secure-store` | Same as above |
| Tenant slug | `expo-secure-store` | Avoids leaking tenant identity via logs |
| User preferences (theme, language) | `expo-secure-store` | Same single storage layer — non-sensitive, but there is no second store to put them in |
| Cached data (e.g. offline event check-ins) | `expo-secure-store` (non-PII only) | Strip PII before caching |

**This app has no AsyncStorage.** Everything persisted — tokens, tenant slug, theme mode, language, offline queues — goes through `lib/storage.ts`, which wraps `expo-secure-store` on native (Keychain / Keystore) and falls back to `window.localStorage`, then an in-memory `Map`, on web only. `@react-native-async-storage/async-storage` is not a dependency. See also [WRAPPER_POLICY.md](WRAPPER_POLICY.md).

### What NOT to store in unencrypted storage

If an unencrypted store (AsyncStorage, `window.localStorage` on the web build, plain files) is ever introduced, it is accessible on rooted/jailbroken devices. Never put there:

- Authentication tokens of any kind
- Passwords or PINs
- Full name, email, or government ID data
- Payment or financial information
- Any data classified as PII under GDPR

### Logging rules

- Never log auth tokens, even at `debug` level
- Strip PII from Sentry events using `beforeSend`:

```typescript
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  beforeSend(event) {
    // Strip authorization headers from breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs.values = event.breadcrumbs.values?.map((b) => {
        if (b.data?.['Authorization']) {
          b.data['Authorization'] = '[Filtered]';
        }
        return b;
      });
    }
    return event;
  },
});
```

---

## 5. Authentication Hardening

### Current token lifecycle

The mobile app stores both access and refresh tokens in `expo-secure-store`. On a 401, `lib/api/client.ts` posts the stored refresh token to `/api/auth/refresh-token`, saves the rotated token values when returned, and retries the original request once. If refresh fails, the app clears stored credentials and redirects to login through `AuthContext`.

### Recommended hardening

Keep backend access tokens short-lived (15-60 minutes) and rotate refresh tokens on every use. The client already supports a rotated `refresh_token` field in the refresh response.

**Target lifecycle:**

| Token | Lifetime | Notes |
|-------|----------|-------|
| Access token | 15 minutes | JWT, signed by backend |
| Refresh token | 30 days | Opaque, single-use, rotated on every refresh |

**Refresh flow implementation:**

```typescript
// lib/api/client.ts - existing fetch-client refresh shape
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/lib/constants';

const refreshToken = await SecureStore.getItemAsync('nexus_refresh_token');
const response = await fetch(`${API_BASE_URL}/api/auth/refresh-token`, {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: refreshToken }),
});
const data = await response.json();
await SecureStore.setItemAsync('nexus_auth_token', data.access_token);
if (data.refresh_token) {
  await SecureStore.setItemAsync('nexus_refresh_token', data.refresh_token);
}
```

### Biometric lock (optional enhancement)

For high-value actions (time credit transfers), prompt the user to re-authenticate with Face ID / fingerprint before proceeding:

```typescript
import * as LocalAuthentication from 'expo-local-authentication';

async function requireBiometric(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirm your identity to transfer time credits',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}
```

Install with: `npx expo install expo-local-authentication`

---

## References

- [OWASP Mobile Security Testing Guide](https://owasp.org/www-project-mobile-security-testing-guide/)
- [Expo Security Considerations](https://docs.expo.dev/guides/security/)
- [Google Play Integrity API](https://developer.android.com/google/play/integrity)
- [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity)
- [expo-build-properties](https://docs.expo.dev/versions/latest/sdk/build-properties/)
