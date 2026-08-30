# iOS release-candidate freeze record

Last reviewed: 2026-08-30

This record has two stages. The source-candidate fields are frozen as soon as the repository
work has settled. The signed-build fields are filled only after Apple enrolment is active and
the production build has passed TestFlight on a real iPhone. This prevents metadata,
screenshots and App Review notes from referring to a different build than the one submitted.

## Freeze prerequisites

- [ ] Apple Developer Program membership is active and agreements are accepted.
- [ ] App Store Connect app record exists and the real numeric Apple ID replaces the
  `APPLE_APP_STORE_CONNECT_APP_ID` placeholder outside source control.
- [ ] The Apple Team ID is configured outside source control; Associated Domains and the
  production `apple-app-site-association` file agree with it.
- [ ] EAS production credentials exist: distribution certificate, provisioning profile and
  APNs key. No credential is copied into Git.
- [x] The candidate comes from a reviewed Git commit, with no unaccounted working-tree
  changes. Unrelated concurrent work is either committed separately or excluded from the
  candidate by an explicit path review.
- [x] The production EAS wrapper reports the expected source commit and refuses to build if
  any path under `mobile/` is staged, modified or untracked. The commit is also embedded as
  `expo.extra.releaseCommit` in the temporary EAS app configuration.
- [x] Mobile tests, typecheck, lint and Expo Doctor pass at the candidate commit.
- [ ] `npm run verify:ios-release` passes without the two expected enrolment-dependent
  failures: the real Team ID/AASA association and numeric App Store Connect Apple ID.
- [x] Backend notification tests and the paid-promotion consent tests pass at the same
  backend commit used by production.
- [x] The unsigned iPhone 16 Pro Max Simulator tour produces the four accepted public
  screenshots and passes checksum, opacity, dimensions, page-content OCR and visual review
  at source commit `58654079a287006b52b1cd53b66db13244f27756` (run `33286909272`).
- [ ] A signed EAS production build processes successfully in App Store Connect/TestFlight.
- [ ] A real-iPhone journey pass covers login, tenant selection, permissions, push receipt
  and tap from background/terminated state, deep links, camera/photos/microphone/location,
  Stripe physical-goods return, account deletion, report/mute/block and accessibility.
- [ ] On-device lock-screen evidence confirms that ordinary pushes do not reveal private
  message, safeguarding, identity, financial or member-detail content.
- [ ] Store copy, privacy answers, age rating, screenshots, review notes and owner/legal
  answers are checked against the exact build.
- [ ] Reviewer credentials are live-verified, then the verification session is logged out.
- [ ] The owner separately authorises TestFlight external testing, App Review submission and
  public release at the appropriate gates.

## Immutable candidate identity

| Field | Frozen value |
|---|---|
| Git source tag | `ios-v1.2.0-build3-rc1` (resolve the immutable commit with `git rev-list -n 1`) |
| Backend commit/version | Same commit resolved by `ios-v1.2.0-build3-rc1` |
| App semantic version | `1.2.0` |
| iOS build number | `3` (planned next production build; confirm from EAS artifact) |
| Expo runtime version | `1.2.0` (`appVersion` policy) |
| EAS build ID | `______________________________` |
| App Store Connect build | `______________________________` |
| Bundle identifier | `ie.project.nexus` |
| EAS production profile | `production` |
| Test device / iOS | `______________________________` |
| Freeze timestamp (UTC) | `______________________________` |
| Frozen by | `______________________________` |

## Hashes and evidence

Record SHA-256 hashes for `mobile/app.json`, `mobile/eas.json`,
`mobile/store.config.js`, every tracked file in `mobile/store-listing/apple/`, and the final
screenshot files. Store the command output with the private release evidence, not by editing
the frozen candidate after approval.

Test/evidence location: `______________________________`

Owner approval reference: `______________________________`
