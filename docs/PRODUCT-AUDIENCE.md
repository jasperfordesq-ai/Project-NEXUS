# Who Project NEXUS Is For

Last reviewed: 2026-08-28

**Project NEXUS is a platform for adults. Signing up requires confirming you are 18 years
of age or older.** That is a product decision taken on 2026-08-25, and this document
records what it means in the code, what the code does *not* do, and how the guardian and
safeguarding capabilities that exist should be described.

It exists because the platform was describing itself two ways at once. Registration has
always required an 18-or-older confirmation on the web app, while the public features page
advertised "consent flows for members under 18", and the native app's sign-up said nothing
about age at all. Anyone comparing the three would reasonably conclude the platform serves
young people. It does not.

## Where the age statement appears

There are three sign-up forms, and since 2026-08-25 all three carry the same declaration
in every language they offer:

| Door | Form | String |
| --- | --- | --- |
| React web app | `react-frontend/src/pages/auth/RegisterPage.tsx` | `auth.json` → `register.terms_agreement` (11 locales) |
| Native app | `mobile/app/(auth)/register.tsx` | `auth.json` → `register.termsAccepted` (7 locales) |
| Accessible frontend | `web-uk/src/views/register.njk` | `lang/<locale>/govuk_alpha.php` → `auth.terms_label` (11 locales) |

`node scripts/check-age-declaration.mjs` holds them together: it checks all 29 strings for
a stated minimum age, and checks that each screen still renders it and still refuses to
submit without the tick. It runs in the i18n job (woken by `lang/**` and the React
locales) and in the mobile job (woken by `mobile/**`).

The gate exists because nothing else could see the disagreement. Every sign-up key was
present in every locale, so both key-set parity gates were green while the three forms said
different things — the same blind spot that let 99,139 PHP values sit in English behind a
green parity gate. Comparing key sets answers a different question from comparing what the
sentence says.

## What the platform enforces, and what it does not

**Enforced.** `terms_accepted` is validated in `App\Services\RegistrationService`
(`'accepted'`), so registration fails without the tick. The acceptance is then recorded
against the specific document version in `user_legal_acceptances` via
`LegalDocumentService::acceptAll()`, with `acceptance_method = 'registration'`, including
IP address and user agent. A member's agreement to the terms — which is where the age
declaration lives — is therefore evidenced per version, not merely assumed.

**Not enforced, deliberately.** No date of birth is collected at sign-up on any of the
three doors, nothing verifies a stated age, and no age check gates general use of the
platform. The declaration is a contractual statement by the member, in the same class as
the terms acceptance beside it. Measured in production on 2026-08-25: **374 members, 9
with a date of birth recorded, and no guardian consent has ever been recorded** (`0` rows).

**A member can still be recorded as a minor.** `users.date_of_birth` is a real column that
staff-facing flows can populate, and `GuardianConsentService::isMinor()` reads it. With a
null date of birth it returns `false`, which is the correct default for an adults-only
platform: absent evidence, an account is an adult account.

## The guardian and safeguarding capabilities that exist

These are real, and several are among the best-built code in the repository. None of them
turns the platform into a service for under-18s, and none should be described as though it
does. Full technical detail is in [SAFEGUARDING-AND-CONSENT.md](SAFEGUARDING-AND-CONSENT.md).

| Capability | What it actually is | Default |
| --- | --- | --- |
| Volunteering guardian consent | The one place a minor check gates an action. Three endpoints (`VolunteerCommunityController`, `VolunteerController` ×2) refuse a sign-up with `GUARDIAN_CONSENT_REQUIRED` when the member's recorded date of birth is under 18 and no active consent exists. | **Off.** Tenant setting `volunteering.guardian_consent_required`, default `false`. |
| Event guardian consent | `event_guardian_consents`: encrypted guardian identity, single-use token, append-only history enforced by a database trigger. It *records* consent; nothing requires it before attendance. | Recorded only |
| Safeguarding assignments | A staff record pairing a supported member with a guardian. Confers **no** capability over the member's account. | Record only |
| Account relationships | Carer permissions between adult accounts (view activity, manage listings, transact). Unrelated to age. | Per-relationship |

**How to describe it.** "Guardian approval for a minor volunteer or event attendee, for
communities that run supervised activity with young people, where a coordinator sets the
account up. Off unless a community turns it on." That is what the public features page now
says, in all eleven languages, including the caveat that the platform itself is for
adults. Do not reintroduce copy that offers under-18 membership.

## Open gaps

Recorded honestly rather than closed, because each needs a decision or content that is not
the code's to write.

1. **Social sign-up makes no age declaration.** The Google/Facebook path
   (`SocialAuthService` → `RegistrationOrchestrationService`) presents no tick-box, by
   design — recording an acceptance the member never gave would fabricate consent. Those
   members meet the terms at first login, through the legal acceptance gate. Closing this
   properly means an age-confirmation step in the social sign-up flow; until then the
   declaration reaches OAuth members one step later than everyone else.
2. **Two tenants' terms documents contain no age clause.** Measured 2026-08-25: the
   `timebank-global` terms (46,238 characters) and the `partner-demo` terms have no
   minimum-age wording. The sign-up form states 18+, but the document it points at does
   not repeat it. Owner/legal decision — an agent should not edit legal text.
3. **Three active cookies documents are empty** (0 characters). Unrelated to age, found in
   the same sweep, and worth fixing before any store submission that links a privacy URL.

## Google Play

The Play Console asks for a target audience and applies its Families policy to apps
targeting children. **The answer is adults only, 18 and over.** The Families policy does
not apply. This is consistent with what all three sign-up forms now say, which is the point
of the gate above: a declaration to a store has to match what the product tells its users.

Google's current Target audience guidance also exposes **Restrict minor access** when
18 and over is the only selected age group. That restriction must be enabled for both the
product decision and the Play-account distribution boundary to agree. It blocks accounts
Google determines are minors from finding, downloading or purchasing the app. Recheck it
in the next editable Console window; do not change declarations during an active review.

The native “Matches” feature is service and skill matching for timebank exchanges, not
dating or romantic matchmaking. That distinction must remain explicit in store copy and
review notes because Google has a separate age-restricted policy for dating/matchmaking.

Primary Google references checked 2026-08-28:

- <https://support.google.com/googleplay/android-developer/answer/9867159>
- <https://support.google.com/googleplay/android-developer/answer/9893335>
- <https://support.google.com/googleplay/android-developer/answer/9876937>

## Apple App Store

The native product must not be marked **Made for Kids**. Its live questionnaire answers
must disclose user-generated content, social media and messaging. Because the membership
terms require a higher minimum age than Apple's capability-based calculation may produce,
select **Override to Higher Age Rating: 18+**. A self-declaration checkbox is not Apple's
Declared Age Range API and must not be described as verified age assurance.

Apple's UGC rule still requires filtering, reporting, blocking and published contact
information for an adults-only social app. The full native decision record, guardian
boundary, Care in Community exclusion and current primary-source list are maintained in
[`../mobile/docs/STORE_AUDIENCE_POLICY.md`](../mobile/docs/STORE_AUDIENCE_POLICY.md).

Store-readiness state for the native app — what is still missing before submission is
possible — is in [../mobile/docs/DISTRIBUTION.md](../mobile/docs/DISTRIBUTION.md).
