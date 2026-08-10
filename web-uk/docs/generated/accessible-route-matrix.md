# Generated Laravel Accessible Route Matrix

Status: **Generated snapshot — structural route inventory, not certification**

Generated: 2026-08-10T06:38:44.020Z
Laravel commit SHA: `f98b8bc1cbcc4d559f5ae918bce16d2353d4fcef`
Web UK repository commit SHA: `f98b8bc1cbcc4d559f5ae918bce16d2353d4fcef`
Laravel working tree dirty: yes
Web UK repository working tree dirty: yes
Provenance caveat: Laravel and Web UK repository working trees were dirty when generated. Commit SHAs identify HEAD only; generated content may include uncommitted changes from the dirty working trees.

| Metric | Count |
| --- | ---: |
| Laravel accessible routes | 707 |
| web-uk routes | 695 |
| Matched routes | 688 |
| Missing routes | 19 |
| Extra web-uk routes | 5 |
| Ignored web-uk infrastructure routes | 3 |

## Family Counts

| Family | Matched | Missing | Extra web-uk | Ignored infrastructure |
| --- | ---: | ---: | ---: | ---: |
| about | 1 | 0 | 0 | 0 |
| accessibility | 1 | 0 | 0 | 0 |
| account | 1 | 0 | 0 | 0 |
| achievements | 10 | 0 | 0 | 0 |
| activity | 2 | 0 | 0 | 0 |
| appreciations | 1 | 0 | 0 | 0 |
| blog | 12 | 0 | 0 | 0 |
| chat | 2 | 0 | 0 | 0 |
| clubs | 1 | 0 | 0 | 0 |
| connections | 5 | 0 | 0 | 0 |
| contact | 2 | 0 | 0 | 0 |
| cookie-consent | 1 | 0 | 0 | 0 |
| cookies | 1 | 0 | 0 | 0 |
| coupons | 2 | 0 | 0 | 0 |
| courses | 26 | 0 | 0 | 0 |
| dashboard | 1 | 0 | 0 | 0 |
| event-templates | 4 | 0 | 0 | 0 |
| events | 93 | 1 | 2 | 0 |
| exchanges | 4 | 0 | 0 | 0 |
| explore | 1 | 0 | 0 | 0 |
| faq | 1 | 0 | 0 | 0 |
| features | 1 | 0 | 0 | 0 |
| federation | 28 | 0 | 0 | 0 |
| feed | 22 | 0 | 0 | 0 |
| goals | 27 | 0 | 0 | 0 |
| group-exchanges | 9 | 0 | 0 | 0 |
| groups | 36 | 0 | 0 | 0 |
| guide | 1 | 0 | 0 | 0 |
| health | 0 | 0 | 0 | 1 |
| help | 1 | 0 | 0 | 0 |
| home | 2 | 0 | 0 | 0 |
| ideation | 34 | 0 | 0 | 0 |
| jobs | 38 | 0 | 0 | 0 |
| kb | 2 | 0 | 0 | 0 |
| leaderboard | 5 | 0 | 0 | 0 |
| legal | 6 | 0 | 0 | 0 |
| listings | 19 | 0 | 1 | 0 |
| login | 7 | 0 | 0 | 0 |
| logout | 1 | 0 | 0 | 0 |
| marketplace | 50 | 0 | 0 | 0 |
| matches | 4 | 0 | 0 | 0 |
| me | 6 | 0 | 0 | 0 |
| members | 11 | 0 | 1 | 0 |
| messages | 18 | 0 | 0 | 0 |
| newsletter | 1 | 0 | 0 | 0 |
| nexus-score | 2 | 0 | 0 | 0 |
| notifications | 6 | 0 | 0 | 0 |
| onboarding | 4 | 0 | 0 | 0 |
| organisations | 9 | 0 | 0 | 0 |
| password | 2 | 0 | 0 | 0 |
| podcasts | 14 | 0 | 0 | 0 |
| polls | 13 | 0 | 0 | 0 |
| premium | 6 | 0 | 0 | 0 |
| profile | 23 | 0 | 0 | 0 |
| register | 2 | 0 | 0 | 0 |
| report-a-problem | 2 | 0 | 0 | 0 |
| resources | 12 | 0 | 0 | 0 |
| reviews | 7 | 0 | 0 | 0 |
| saved | 2 | 0 | 0 | 0 |
| search | 6 | 0 | 0 | 0 |
| service-unavailable | 0 | 0 | 0 | 1 |
| session | 0 | 0 | 0 | 1 |
| settings | 13 | 11 | 0 | 0 |
| skills | 1 | 0 | 0 | 0 |
| trust-and-safety | 1 | 0 | 0 | 0 |
| users | 3 | 0 | 0 | 0 |
| venues | 0 | 5 | 0 | 0 |
| verify-email | 1 | 0 | 0 | 0 |
| volunteering | 52 | 0 | 1 | 0 |
| wallet | 6 | 0 | 0 | 0 |
| whats-on | 0 | 2 | 0 | 0 |

## Missing Laravel Routes

| Method | Path | Family | Handler | Blade view | Auth | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/events/{param}/check-in/code` | events | eventsOfflineCheckinCode |  | public-or-unknown |  |
| GET | `/settings/guardians` | settings | settingsGuardians | settings-guardians | auth-optional |  |
| GET | `/settings/linked-accounts/activity/{param}` | settings | settingsLinkedAccountActivity | settings-linked-account-activity | auth-optional |  |
| GET | `/settings/linked-accounts/messages/{param}` | settings | settingsLinkedAccountMessages |  | public-or-unknown |  |
| GET | `/settings/linked-accounts/messages/{param}/{param}` | settings | settingsLinkedAccountThread |  | public-or-unknown |  |
| GET | `/settings/support-actions` | settings | settingsSupportActions | settings-support-actions | auth-optional |  |
| POST | `/settings/guardians/permissions` | settings | settingsUpdateGuardianPermissions |  | auth-optional |  |
| POST | `/settings/guardians/respond` | settings | settingsRespondToGuardian |  | auth-optional |  |
| POST | `/settings/linked-accounts/message-access/request` | settings | settingsRequestMessageAccess |  | auth-optional |  |
| POST | `/settings/linked-accounts/message-access/withdraw` | settings | settingsWithdrawMessageAccess |  | auth-optional |  |
| POST | `/settings/linked-accounts/messages/{param}/purpose` | settings | settingsLinkedAccountMessagesPurpose |  | auth-optional |  |
| POST | `/settings/support-actions/respond` | settings | settingsRespondToSupportAction |  | auth-optional |  |
| GET | `/venues` | venues | venuesIndex | venues | auth-required | feature:partner_venues |
| GET | `/venues/checkin/{param}` | venues | venuesCheckin | venue-checkin | auth-optional | feature:partner_venues |
| GET | `/venues/pass` | venues | venuesPass | venue-pass | auth-optional | feature:partner_venues |
| POST | `/venues/checkin/{param}` | venues | venuesCheckinStore | venue-checkin | auth-optional | feature:partner_venues |
| POST | `/venues/pass/rotate` | venues | venuesPassRotate |  | auth-optional | feature:partner_venues |
| GET | `/whats-on` | whats-on | whatsOnIndex | whats-on | public-or-unknown | feature:events; feature:public_events |
| GET | `/whats-on/{param}` | whats-on | whatsOnShow | whats-on-detail | public-or-unknown | feature:events; feature:public_events |

## Extra Web UK Routes

| Method | Path | Family | Web UK view | Web UK file |
| --- | --- | --- | --- | --- |
| GET | `/events/my` | events |  | web-uk/src/server.js |
| POST | `/events/{param}/rsvp/remove` | events |  | web-uk/src/server.js |
| GET | `/listings/{param}/delete` | listings |  | web-uk/src/server.js |
| POST | `/members/{param}/connect` | members |  | web-uk/src/server.js |
| GET | `/volunteering/credentials/{param}/download` | volunteering | streamed-download | web-uk/src/routes/volunteering-actions.js |

## Ignored Web UK Infrastructure Routes

| Method | Path | Family | Kind |
| --- | --- | --- | --- |
| GET | `/health` | health | infrastructure |
| GET | `/service-unavailable` | service-unavailable | infrastructure |
| POST | `/session/touch` | session | infrastructure |
