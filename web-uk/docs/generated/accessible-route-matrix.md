# Generated Laravel Accessible Route Matrix

Status: **Generated snapshot — structural route inventory, not certification**

Generated: 2026-07-15T14:45:46.507Z
Laravel commit SHA: `903d03d3db78bbf87129ad35728be3b72819acaf`
Web UK repository commit SHA: `a3f18f0699f5590a47220f3fd501e93258f286f0`
Laravel working tree dirty: yes
Web UK repository working tree dirty: yes
Provenance caveat: Laravel and Web UK repository working trees were dirty when generated. Commit SHAs identify HEAD only; generated content may include uncommitted changes from the dirty working trees.

| Metric | Count |
| --- | ---: |
| Laravel accessible routes | 689 |
| web-uk routes | 695 |
| Matched routes | 688 |
| Missing routes | 1 |
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
| settings | 13 | 0 | 0 | 0 |
| skills | 1 | 0 | 0 | 0 |
| trust-and-safety | 1 | 0 | 0 | 0 |
| users | 3 | 0 | 0 | 0 |
| verify-email | 1 | 0 | 0 | 0 |
| volunteering | 52 | 0 | 1 | 0 |
| wallet | 6 | 0 | 0 | 0 |

## Missing Laravel Routes

| Method | Path | Family | Handler | Blade view | Auth | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/events/{param}/check-in/code` | events | eventsOfflineCheckinCode |  | public-or-unknown |  |

## Extra Web UK Routes

| Method | Path | Family | Web UK view | Web UK file |
| --- | --- | --- | --- | --- |
| GET | `/events/my` | events |  | C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\server.js |
| POST | `/events/{param}/rsvp/remove` | events |  | C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\server.js |
| GET | `/listings/{param}/delete` | listings |  | C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\server.js |
| POST | `/members/{param}/connect` | members |  | C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\server.js |
| GET | `/volunteering/credentials/{param}/download` | volunteering | streamed-download | C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\routes\volunteering-actions.js |

## Ignored Web UK Infrastructure Routes

| Method | Path | Family | Kind |
| --- | --- | --- | --- |
| GET | `/health` | health | infrastructure |
| GET | `/service-unavailable` | service-unavailable | infrastructure |
| POST | `/session/touch` | session | infrastructure |
