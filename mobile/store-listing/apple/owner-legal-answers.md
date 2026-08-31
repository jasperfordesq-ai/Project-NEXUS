# Apple owner and legal answer sheet

Last reviewed: 2026-08-27

This sheet separates answers supported by the product and repository from declarations
that only the Apple Account Holder or a legal adviser can make. It is not legal advice.
Record the final owner decisions here before entering them in App Store Connect.

## Answers supported by the product

| App Store Connect question | Prepared answer | Evidence and qualification |
|---|---|---|
| Does the app contain, show or access third-party content? | **Yes** | Members create posts, messages, photos, listings, events and reviews. The platform terms say members retain ownership and grant the Platform and Community Operator a non-exclusive worldwide royalty-free licence to display, reproduce and distribute that content within the service. The disclaimer requires uploaders to own or be authorised to use it. Reporting, blocking and moderation are available. The Account Holder should confirm that these terms are the intended governing terms before answering. |
| Does the app use non-exempt encryption? | **No** | `ios.config.usesNonExemptEncryption` is `false`. The release uses operating-system and standard service encryption such as HTTPS/TLS and secure credential storage; the audit found no proprietary or military encryption. Reconfirm this if encryption features or dependencies change. |
| Is paid identity verification available in this iOS release? | **No** | The native payment adapter rejects identity-payment attempts, and the review notes explain that the digital verification badge purchase is deliberately unavailable in mobile. The physical-goods marketplace may use Stripe. |
| Does the app contain user-generated content and social interaction? | **Yes** | The age-rating worksheet declares user-generated content, social media and messaging/chat. Review notes direct Apple to Report, Mute and Block controls. |
| Are promotional push notifications optional? | **Yes** | The separate paid-promotion preference is default-off, can be withdrawn in Settings, and does not control ordinary service notifications. Native non-promotional alerts keep detailed content in the authenticated app, use only a privacy-safe category/curated title plus generic body on the lock screen, and carry a validated authenticated destination for the tap. |
| Copyright year | **2026** | Enter the year followed by the person or entity that owns the app copyright. Do not include a URL. The rights-holder name still requires the owner decision below. |

Apple sources: [App information and Content Rights](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information),
[platform version fields and copyright format](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information),
and [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

## Owner decisions required

### 1. EU Digital Services Act trader status

Apple requires every developer to declare a status, even when not distributing in the EU.
Apple says the developer must self-assess and that commercial activity, advertising,
revenue and development in a professional or business capacity can indicate trader status.
Charitable or non-profit status does not automatically make the account a non-trader.

- [ ] **Trader** — chosen after owner/legal assessment.
- [ ] **Not a trader** — chosen after owner/legal assessment.
- [ ] **No EU App Store distribution initially** — this avoids acting as an App Store trader
  in the EU for that release, but a status declaration is still required and Ireland cannot
  be selected as an initial territory.

If **Trader** is selected, prepare the public-facing address or P.O. Box, phone number and
email address, plus the verification documents Apple requests. Apple states that verified
trader contact information is displayed on EU product pages. For an individual account,
all three contact fields must be supplied for display.

Owner decision: `______________________________`

Assessment/evidence retained at: `______________________________`

Official source: [Apple — EU Digital Services Act trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)

### 2. First-release territories

Recommended staged choice: **Ireland and United Kingdom only**, because these are the
known initial communities and support context. Ireland invokes the EU trader-information
decision above. This is a release-risk recommendation, not a claim that the service cannot
operate elsewhere. Expand only after the first production build and support process are
proven, reviewing country-specific compliance before each expansion.

- [ ] Approve Ireland and United Kingdom.
- [ ] Approve a different exact territory list: `______________________________`

Owner decision: `______________________________`

### 3. Seller/developer and copyright owner

The App Store seller name is governed by the Apple Developer enrolment and cannot be
invented from the repository. Confirm the exact public names below.

Apple seller/developer name: `______________________________`

Copyright field, recommended format: `2026 ______________________________`

### 4. App Review contact

Use a person who can answer Apple during the review window. These details belong in App
Store Connect and the protected local handoff, not Git.

First name: `__________________`  Last name: `__________________`

Direct email: `______________________________`

Direct phone with country code: `______________________________`

### 5. Final legal approval

- [ ] The Platform Terms licence accurately covers the third-party content used in the app.
- [ ] The privacy disclosure accurately describes paid local promotions and data use.
- [ ] The App Privacy worksheet is approved for entry in App Store Connect.
- [ ] The DSA trader decision and public contact details are approved.
- [ ] The territory list, seller name and copyright owner are approved.

Approved by: `______________________________`  Date: `__________________`
