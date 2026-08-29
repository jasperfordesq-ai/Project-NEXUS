# Apple review notes draft

Last reviewed: 2026-08-28

Timebank Global is a multi-tenant community timebanking app. Select **Partner Demo** on the
community picker and sign in with the review account supplied privately in App Store
Connect. The review account contains fictional demonstration data and does not require an
invitation, one-time code, payment or location restriction.

Time credits record exchanged hours and have no cash value. The only card-payment surface
available in this mobile release is the optional marketplace for second-hand physical goods
between members, for pickup or delivery outside the app. Stripe processes those payments.
Paid identity verification, which could unlock a digital badge, is deliberately unavailable
inside the mobile app.

Useful review routes:

- Settings contains privacy controls, data export, blocked users and in-app account deletion.
- Device notifications are enabled only from Settings. Paid promotional notifications have
  a separate, default-off opt-in and can be switched off there at any time.
- A feed item's overflow menu provides Not interested, Hide, Mute member and Report.
  Reports notify the community moderation team.
- A same-community member profile has a Safety section with Block member. Blocking removes
  any connection and prevents further contact; Settings > Blocked users can reverse it.
- Support provides privacy, terms, safeguarding and contact information.
- The source-code and AGPL attribution link appears in the Profile/settings family.

Suggested deterministic review walk using the current fictional dataset:

- Home > a feed item's overflow menu > Report demonstrates the moderation submission.
- Members > **Sam Chen** > Safety > Block member demonstrates blocking; Settings > Blocked
  users reverses it so the review account remains reusable.
- Marketplace > **Quiet room comfort box** > Buy now displays a €24 fixed-price, like-new
  physical item for local pickup and the Stripe money-payment path. Back out before placing
  the order unless a live production payment is specifically required; Stripe test cards do
  not work in live mode.
- Settings > Delete account displays the permanent-deletion confirmation. The endpoint is
  live; completing it should be the reviewer's final action because it invalidates the
  supplied account. Contact the review contact if replacement access is then required.

The dataset behind these steps was live-verified on 27 August 2026: the account could see
43 other fictional members, 20 first-page feed items and 18 active marketplace listings.
See `reviewer-journey-evidence.md` for the pre-submission recheck.

The first Apple release is iPhone-only. It does not claim iPad support. Camera, photos,
microphone, location, notifications and Face ID are requested only when the member invokes
the corresponding feature. Reviewer credentials and personal contact details must be
entered only in App Store Connect, never committed to this repository.

Age-rating answers declare user-generated content, social media, messaging/chat and
frequent contests because challenges and leaderboards are recurring features. The product
requires members to declare that they are 18 or over, so the release uses an 18+ developer
override even if Apple's capability-based calculation is lower. The app is not in the Kids
category. “Matches” means matching offers, requests and skills for timebank exchanges; it
is not dating or romantic matchmaking. Guardian-consent and Care in Community workflows
are not part of either native app.
