# Apple age-rating worksheet

Last reviewed: 2026-08-28

This worksheet maps the current native app to Apple's July 2026 age-rating
questionnaire. Enter these answers manually in App Store Connect; EAS Metadata's beta
schema still models the previous questionnaire. Recheck the shipped iOS build and the
live questionnaire before saving.

## In-app controls and capabilities

| Apple question | Draft answer | Evidence and boundary |
|---|---|---|
| Parental controls | No | The app has privacy and community controls, but no parent or guardian control surface. |
| Age assurance | No | Registration requires a member to declare that they are 18 or over, but the app does not use Apple's Declared Age Range API, age estimation, or a verified age credential. Do not misdescribe the declaration checkbox as age assurance. |
| Unrestricted web access | No | The app opens specific support, policy and feature URLs; it is not a general-purpose embedded browser and cannot navigate to arbitrary sites. |
| User-generated content | Yes | Members publish feed posts, comments, photos, listings, reviews, group content and other community material. |
| Social media | Yes | The feed distributes member content and supports reactions, comments, search and discovery. Apple treats this as social media regardless of the App Store category. |
| Social media disabled for users under 13 | No | Apple requires at least the Declared Age Range API for this answer. The product's 18+ declaration alone does not satisfy that definition. |
| Messaging and chat | Yes | Members can exchange direct and group messages. |
| Advertising | Yes | The platform can send paid promotional push campaigns. There is no ad SDK or cross-app tracking, and campaigns require the member's separate explicit opt-in, but answering No would conceal the paid promotion capability. |

The expected calculated global rating is at least **13+** because Social Media is Yes.
Timebank Global registration and store copy say members must be 18 or over, so select
**Override to Higher Age Rating: 18+** for a consistent public presentation. This is a
developer override, not a claim that the app contains Apple's mature-content descriptors.
Do not select Made for Kids.

Guardian-consent records elsewhere in the platform are not parental controls or a child
membership path and do not change any answer above. Care in Community is excluded from
both native apps. See `../../docs/STORE_AUDIENCE_POLICY.md` for the enforced boundary.

## Content descriptions

| Apple descriptor | Draft answer | Reason |
|---|---|---|
| Profanity or crude humour | Infrequent | Community UGC may occasionally contain language before moderation. Selecting None would be too absolute for a social feed. |
| Horror or fear themes | None | Not part of the product or maintained editorial content. |
| Alcohol, tobacco or drug use or references | None | Not part of the product or maintained editorial content. Reassess if the review tenant contains such UGC. |
| Medical or treatment information | None | The app does not diagnose, prescribe or provide treatment guidance. |
| Health or wellness topics | None | General neighbour support and volunteering are not presented as health or wellness advice. |
| Mature or suggestive themes | None | Not part of the product or maintained editorial content. Reassess the exact review data. |
| Sexual content or nudity | None | Not permitted or intentionally supplied. |
| Graphic sexual content and nudity | None | Not permitted or intentionally supplied. |
| Cartoon or fantasy violence | None | No game or entertainment violence. |
| Realistic violence | None | No intended violent content. |
| Prolonged graphic or sadistic realistic violence | None | No intended violent content. |
| Guns or other weapons | None | No intended weapons content. |
| Gambling | No | Time credits have no cash value and cannot be wagered or redeemed for money. |
| Simulated gambling | None | No wagering mechanic. |
| Contests | Frequent | Challenges, achievements and leaderboards are recurring product capabilities; Apple's definition includes rankings, rewards and personal-goal competitions. |
| Loot boxes | No | No randomized purchasable virtual items. |

If App Store Connect presents different wording or a new question, answer the live form
from the shipped build rather than forcing it into this table. Record the final answers
and Apple's calculated regional ratings in the release evidence.

## Guideline 1.2 evidence to walk on iPhone

- Create a post containing a known spam pattern and prove it is hidden and queued rather
  than broadly distributed.
- From another member's feed item, prove Report sends the chosen reason to moderators and
  Mute removes that member's feed content.
- From a same-community member profile, prove Block removes the connection, prevents
  messaging and makes the member available under Settings > Blocked users for later
  unblocking.
- Prove the Support area and support URL expose working contact and safeguarding routes.
- Confirm the review tenant contains only fictional, age-appropriate demonstration data.

The current server auto-filter detects spam patterns; it is not a comprehensive multilingual
profanity or image classifier. Do not claim that it is. Apple ultimately judges whether the
combination of filtering, human moderation, reporting, blocking and published contact
information satisfies Guideline 1.2.

Authoritative references:

- <https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/>
- <https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions>
- <https://developer.apple.com/app-store/review/guidelines/#user-generated-content>
