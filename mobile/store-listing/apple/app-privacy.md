# Apple app privacy working answers

Last reviewed: 2026-08-27

This is a conservative preparation sheet for App Store Connect. It is not a published
privacy label and must be compared with the exact signed iOS binary and live processor
configuration before answers are submitted.

For the opening questions, answer **Yes, data is collected**, **No, data is not used to
track users across other companies' apps or websites**, and **No, data is not sold**.
Collection includes data sent off the device to Project NEXUS or its service processors;
it is not limited to card data stored by Project NEXUS itself.

| Apple data type | Collected / linked | Purpose and source evidence |
| --- | --- | --- |
| Contact Info — Name | Yes / linked | Required account identity and community profile |
| Contact Info — Email Address | Yes / linked | Account, authentication, verification, support and notifications |
| Contact Info — Phone Number | Yes / linked | Required at registration; community contact and arranged exchanges |
| Contact Info — Physical Address | Yes / linked | Registration asks for a location/address; profiles, listings, delivery and pickup may contain member-entered locations |
| Location — Precise Location | Optional / linked | Used when the member invokes nearby search and grants native location permission; stored member location can also be used for radius-filtered promotional campaigns after separate campaign opt-in |
| Location — Coarse Location | Optional / linked | Nearby discovery and member-entered profile/listing location; can be used for radius-filtered promotional campaigns after separate campaign opt-in |
| Financial Info — Payment Info | Optional / linked by Stripe | Project NEXUS receives payment intent/order state rather than card details, so it is absent from the app-level manifest. However, the pinned Stripe iOS manifest itself declares linked Payment Info for App Functionality, so include it in the App Store privacy label |
| Purchases — Purchase History | Optional / linked | Marketplace orders, offers, refunds, delivery and pickup state |
| Identifiers — User ID | Yes / linked | Account, tenant membership and authenticated operations; selects an opted-in recipient for promotional campaigns |
| Identifiers — Device ID | Optional / linked | Expo/APNs push token and registered notification device, including delivery of separately opted-in promotional campaigns |
| User Content — Photos or Videos | Optional / linked | Profile, feed, listings, marketplace, groups and events |
| User Content — Audio Data | Optional / linked | Voice messages sent deliberately by a member |
| User Content — Emails or Text Messages | Optional / linked | Direct, group and federated member messages |
| User Content — Customer Support | Optional / linked | Support requests, reports and diagnostic context supplied by a member |
| User Content — Other User Content | Optional / linked | Posts, comments, listings, event answers, reviews, goals, polls and other member-authored material |
| Usage Data — Product Interaction | Yes / linked | Exchanges, time-credit ledger activity, events, groups, volunteering, reactions and feature interaction. The pinned Stripe iOS manifest also declares linked Product Interaction for Analytics and App Functionality |
| Diagnostics — Crash Data | Optional / not linked | The pinned Sentry Cocoa manifest declares Crash Data for App Functionality; `sendDefaultPii` is false and events pass through the app scrubber |
| Diagnostics — Performance Data | Optional / not linked | The pinned Sentry Cocoa manifest declares Performance Data for App Functionality when production diagnostics are enabled |
| Diagnostics — Other Diagnostic Data | Optional / not linked | The pinned Sentry Cocoa manifest declares Other Diagnostic Data for App Functionality; application events are scrubbed before transmission |
| Other Data | Yes / linked | Time-credit balances, exchange records, tenant membership, badges and operational audit state |
| Sensitive Info | Potentially optional / linked | Tenant-defined event forms and safeguarding workflows can contain member-supplied sensitive answers; declare conservatively unless the exact release is proved unable to collect them |

Purposes are primarily **App Functionality**, with **Product Personalization** for location,
search, content and interaction used to tailor discovery/matches. Select **Analytics** for
Product Interaction because Stripe's own manifest declares it; the pinned Sentry manifest
classifies its diagnostic entries as App Functionality, not Analytics. Select **Developer's
Advertising or Marketing** for location, User ID, Device ID and Other Data used to select or
deliver separately opted-in paid promotional campaigns. Do not select third-party advertising
or cross-app tracking.

Processors visible in the current source/build configuration include:

- Stripe for optional physical-goods payments;
- Expo and Apple Push Notification service for push delivery and device tokens;
- Sentry EU for crash and performance diagnostics when the production DSN is configured;
- Pusher for real-time messaging transport;
- the Project NEXUS production API and its infrastructure providers.

The app-level manifest in `app.json` declares the Project NEXUS data types above, excluding
Stripe-held card details and third-party-only diagnostics. Source inspection of the native
versions selected by the installed React Native wrappers found:

- `@stripe/stripe-react-native@0.50.3` requests Stripe iOS `~> 24.19.0`. The official
  `24.19.0` manifests declare linked Payment Info and Product Interaction, no tracking,
  UserDefaults reason `CA92.1`, and Analytics/App Functionality purposes.
- `@sentry/react-native@7.2.0` pins Sentry Cocoa `8.56.1`. Its official manifest declares
  unlinked Crash Data, Performance Data and Other Diagnostic Data for App Functionality,
  no tracking, and UserDefaults/boot-time/file-timestamp reasons.

The first successful EAS Simulator build was inspected on 2026-08-27. Its final `.app`
contained 21 privacy manifests: the root manifest declared the expected 18 Project NEXUS
data types, no tracking and no tracking domains; resolved Stripe bundles declared Payment
Info and Product Interaction where applicable; and Sentry declared unlinked crash,
performance and other diagnostics. All inspected Stripe and Sentry manifests disabled
tracking. Before submitting these answers, repeat that comparison against the exact signed
release archive and generate the Xcode privacy report or equivalent if available.
