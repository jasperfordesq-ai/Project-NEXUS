# Generated Laravel Accessible Route Matrix

Status: **Generated snapshot — structural route inventory, not certification**

Generated: 2026-08-17T12:12:09.177Z
Laravel commit SHA: `022ebda466a6d2307388248d2d6352c13ab11e77`
Web UK repository commit SHA: `022ebda466a6d2307388248d2d6352c13ab11e77`
Laravel working tree dirty: yes
Web UK repository working tree dirty: yes
Provenance caveat: Laravel and Web UK repository working trees were dirty when generated. Commit SHAs identify HEAD only; generated content may include uncommitted changes from the dirty working trees.

| Metric | Count |
| --- | ---: |
| Laravel accessible routes | 707 |
| web-uk routes | 725 |
| Matched routes | 707 |
| Missing routes | 0 |
| Extra web-uk routes | 15 |
| Ignored web-uk infrastructure routes | 4 |

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
| cookie-consent | 1 | 0 | 1 | 0 |
| cookies | 1 | 0 | 0 | 0 |
| coupons | 2 | 0 | 0 | 0 |
| courses | 26 | 0 | 0 | 0 |
| dashboard | 1 | 0 | 0 | 0 |
| event-templates | 4 | 0 | 0 | 0 |
| events | 94 | 0 | 2 | 0 |
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
| legal | 6 | 0 | 3 | 0 |
| legal-acceptance | 0 | 0 | 2 | 0 |
| listings | 19 | 0 | 1 | 0 |
| login | 7 | 0 | 0 | 0 |
| logout | 1 | 0 | 0 | 0 |
| marketplace | 50 | 0 | 1 | 0 |
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
| podcasts | 14 | 0 | 1 | 0 |
| polls | 13 | 0 | 0 | 0 |
| premium | 6 | 0 | 0 | 0 |
| privacy | 0 | 0 | 1 | 0 |
| profile | 23 | 0 | 0 | 0 |
| register | 2 | 0 | 0 | 0 |
| report-a-problem | 2 | 0 | 0 | 0 |
| resources | 12 | 0 | 0 | 0 |
| reviews | 7 | 0 | 0 | 0 |
| saved | 2 | 0 | 0 | 0 |
| search | 6 | 0 | 0 | 0 |
| service-unavailable | 0 | 0 | 0 | 1 |
| session | 0 | 0 | 0 | 1 |
| settings | 24 | 0 | 0 | 0 |
| skills | 1 | 0 | 0 | 0 |
| terms | 0 | 0 | 1 | 0 |
| trust-and-safety | 1 | 0 | 0 | 0 |
| users | 3 | 0 | 0 | 0 |
| venues | 5 | 0 | 0 | 0 |
| verify-email | 1 | 0 | 0 | 0 |
| version | 0 | 0 | 0 | 1 |
| volunteering | 52 | 0 | 1 | 0 |
| wallet | 6 | 0 | 0 | 0 |
| whats-on | 2 | 0 | 0 | 0 |

## Missing Laravel Routes

| Method | Path | Family | Handler | Blade view | Auth | Gates |
| --- | --- | --- | --- | --- | --- | --- |
| - | - | - | - | - | - | - |

## Extra Web UK Routes

| Method | Path | Family | Web UK view | Web UK file |
| --- | --- | --- | --- | --- |
| POST | `/cookie-consent/hide` | cookie-consent |  | web-uk/src/server.js |
| GET | `/events/my` | events |  | web-uk/src/server.js |
| POST | `/events/{param}/rsvp/remove` | events |  | web-uk/src/server.js |
| GET | `/legal-acceptance` | legal-acceptance | legal/accept | web-uk/src/routes/legal-acceptance.js |
| POST | `/legal-acceptance` | legal-acceptance |  | web-uk/src/routes/legal-acceptance.js |
| GET | `/legal/{param}/versions` | legal | legal/versions | web-uk/src/routes/legal.js |
| GET | `/legal/{param}/versions/{param}` | legal | legal/version | web-uk/src/routes/legal.js |
| GET | `/legal/{param}/versions/compare` | legal | legal/compare | web-uk/src/routes/legal.js |
| GET | `/listings/{param}/delete` | listings |  | web-uk/src/server.js |
| GET | `/marketplace/{param}/delete` | marketplace | confirm-delete | web-uk/src/routes/marketplace-actions.js |
| POST | `/members/{param}/connect` | members |  | web-uk/src/server.js |
| GET | `/podcasts/studio/{param}/episodes/{param}/delete` | podcasts | confirm-delete | web-uk/src/routes/podcast-actions.js |
| GET | `/privacy` | privacy |  | web-uk/src/routes/legal.js |
| GET | `/terms` | terms |  | web-uk/src/routes/legal.js |
| GET | `/volunteering/credentials/{param}/download` | volunteering | streamed-download | web-uk/src/routes/volunteering-actions.js |

## Ignored Web UK Infrastructure Routes

| Method | Path | Family | Kind |
| --- | --- | --- | --- |
| GET | `/health` | health | infrastructure |
| GET | `/service-unavailable` | service-unavailable | infrastructure |
| POST | `/session/touch` | session | infrastructure |
| GET | `/version` | version | infrastructure |
