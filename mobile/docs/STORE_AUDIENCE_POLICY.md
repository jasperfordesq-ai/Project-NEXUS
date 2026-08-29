# Native Store Audience Policy

Last reviewed: 2026-08-28

## Decision fixed by the product owner

**Both native applications are for adults aged 18 and over. They are not children's
apps, mixed-audience apps, family apps, or a route through which a child can become a
member.** This is a release invariant, not marketing language.

The following consequences are deliberate:

- Google Play's only selected target age group must be **18 and over**. Do not select a
  child or teen group merely to make the app visible to more accounts.
- In Play Console, enable **Restrict minor access**. Google says this option becomes
  available when 18 and over is the only selected group and prevents accounts Google
  determines are under 18 from finding, downloading, purchasing, or renewing purchases in
  the app. This Console action must be checked in the next editable release window; do not
  change declarations while a release is under review.
- On Apple, do not select **Made for Kids**. Answer the live questionnaire truthfully and
  select **Override to Higher Age Rating: 18+**, because the product terms require a higher
  minimum age than Apple's capability-based calculation may produce.
- A registration declaration is not verified age assurance. Until the app actually uses a
  platform age-range or verified-age mechanism, Apple **Age assurance** and **Social media
  disabled for users under 13** remain No.

The canonical cross-client registration evidence is
[`../../docs/PRODUCT-AUDIENCE.md`](../../docs/PRODUCT-AUDIENCE.md), guarded by
`node scripts/check-age-declaration.mjs` at repository root.

## Guardian consent does not create a native child journey

The platform backend and staffed web surfaces contain guardian-consent records for unusual
operator-managed situations such as a supervised event or volunteering activity. Those
records are safeguarding infrastructure; they do not mean that a child may register for or
use either native app.

Therefore:

- `events/:id/guardian-consent` is deliberately **out of native scope**, not an unfinished
  mobile module.
- Do not add a native guardian invitation, consent-token, parental-control, child-profile,
  or under-18 onboarding route.
- Do not describe staff-recorded safeguarding assignments as authority over an account.
- Adult-to-adult linked-account support remains a separate consent-based capability.
- If a tenant chooses to run supervised activity involving a minor, its authorised staff
  handle the exceptional record through the maintained web/operator workflow. That does
  not change the native audience.

## Care in Community is excluded from both native apps

**Care in Community is not part of the Android or iOS application product.** Every
`caring-community/*` route is recorded as `out-of-scope` in `parity-map.json`. Do not add
native navigation, API clients, screens, deep links, store copy, screenshots, notification
destinations, or background tasks for it unless the product owner explicitly reverses this
decision and the safeguarding/privacy review is repeated first.

This also includes the `wallet/regional-points` alias: despite its wallet-shaped URL,
its controller, feature gate and ledger belong to Care in Community. It must not be used
to smuggle part of that excluded product into either native app.

This exclusion does not remove the web module and does not say anything about its quality.
It fixes the boundary of the two native products.

## Google Play declarations

| Console field | Required answer or action | Why |
| --- | --- | --- |
| Target audience | **18 and over only** | The product requires adult membership. |
| Restrict minor access | **Enabled** | Adds Play-account-level distribution protection for minors. |
| Designed for children | **No** | No child audience or child membership journey exists. |
| Ads | **No ad SDK**; disclose paid promotional notifications wherever the live form asks about promotion/advertising | Paid campaigns exist but are separately opted into and do not use behavioural ad tracking. |
| Users interact / UGC | **Yes** | Feed, comments, groups, reviews, listings and messages are user-generated. |
| Child-safety standards | Complete accurately despite the adults-only audience | The Social category and UGC still require published standards and reporting. |
| Content rating | Answer from the shipped build | An adults-only target declaration is not permission to conceal UGC, messaging, location sharing, purchases, or contests. |

The app's “Matches” feature compares offers, requests, skills, availability and distance for
timebank exchanges. It is **service and skill matching**, not dating, romantic matching,
anonymous chat, or random chat. Store copy and reviewer notes must say this plainly because
Google has separate age-restricted rules for dating and matchmaking products.

Google's Families requirements apply when children are in the target audience. Our answer
is not “mixed audience with an age screen”; it is “adults only,” backed by the distribution
restriction and the in-product declaration. General UGC, privacy, Data safety, content
rating and child-safety obligations still apply.

## Apple declarations

| App Store Connect field | Required answer or action |
| --- | --- |
| Made for Kids | **No** |
| User-generated content | **Yes** |
| Social media | **Yes** |
| Messaging and chat | **Yes** |
| Age assurance | **No**, until a real supported API or verified mechanism ships |
| Social media disabled under 13 | **No**, until Apple’s required mechanism ships |
| Age category | **Override to Higher Age Rating: 18+** |
| Age Suitability URL | Use the maintained public page once it explicitly records this adults-only policy |

Apple Guideline 1.2 requires filtering objectionable material, reporting, blocking and
published contact information. These controls exist, but must be walked again on the exact
iPhone release candidate. Apple’s Declared Age Range API is not present in the Expo 54 app;
do not claim it is. Its use is a separate native-platform design and build decision,
especially because the current app supports operating systems older than iOS 26.

Starting in September 2026 Apple says submissions must declare whether the app has social
media capabilities. The answer is Yes. Recheck the live questionnaire and guidelines at
submission time rather than copying an older form blindly.

## Payment-sensitive modules

Do not treat a missing payment surface as an ordinary parity gap:

- Google says Play Billing must not be used for tax-exempt donations and other listed
  exceptions.
- Apple permits direct in-app fundraising only for an Apple-approved nonprofit, with Apple
  Pay support and the required disclosures/receipts. We have not recorded that approval.
- Consequently, native `premium`/fundraising screens remain policy-blocked until the Apple
  nonprofit status and exact payment design are documented. No external purchase link may
  be added as a shortcut.
- Physical-goods marketplace payments remain separately permitted and must continue to be
  described as physical goods consumed outside the app.

## Release guardrails

Before either native submission:

1. Run the root age-declaration check and `npm run check:store-audience` in `mobile/`.
2. Confirm Play still has only 18 and over selected and Restrict minor access enabled.
3. Confirm Apple is not Made for Kids and carries the 18+ override.
4. Confirm the live terms, privacy policy, store descriptions and reviewer notes all say
   adult membership and do not advertise guardian consent as child access.
5. Answer UGC, messaging, social, location, purchasing and contest questions from the exact
   shipped build.
6. Recheck all primary sources below; store rules are external and may change.

## Primary sources checked on 28 August 2026

- Google Play, target audience and Restrict minor access:
  <https://support.google.com/googleplay/android-developer/answer/9867159>
- Google Play Families Policy Requirements:
  <https://support.google.com/googleplay/android-developer/answer/9893335>
- Google Play user-generated content:
  <https://support.google.com/googleplay/android-developer/answer/9876937>
- Google Play payments:
  <https://support.google.com/googleplay/android-developer/answer/9858738>
- Apple App Review Guidelines, including Guidelines 1.2, 1.3, 3.1 and 3.2:
  <https://developer.apple.com/app-store/review/guidelines/#user-generated-content>
- Apple, setting an app age rating and overriding a higher contractual minimum:
  <https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/>
- Apple age-rating values and capability descriptors:
  <https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions>
- Apple Declared Age Range API:
  <https://developer.apple.com/documentation/DeclaredAgeRange>
