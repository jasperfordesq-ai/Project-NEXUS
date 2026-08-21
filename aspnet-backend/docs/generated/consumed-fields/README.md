# Consumed-Field Manifest (generated)

Generated: 2026-08-21T13:41:18.924Z

- Repository SHA: `b3e9047c66de46190cfb3759d377f15fc1fb6630`
- Working tree at generation: 37 modified path(s)
- Generator: `aspnet-backend/scripts/build-consumed-field-manifest.mjs`
- Scope authority: [ADR-0004](../../decisions/ADR-0004-journey-equivalence-is-the-target.md)

This is the reader index behind the response harness's **consumed-field mode**.
ADR-0004 puts a response field in scope only if a client reads it, acts on it,
or its difference changes an outcome. This file records, for every field name
any client plausibly reads, which clients read it and where.

## Counts

| Client | Source | Files scanned | Field names seen |
| --- | --- | ---: | ---: |
| `react` | `react-frontend/src` | 2658 | 31585 |
| `web-uk` | `web-uk/src` | 443 | 9672 |
| `mobile` | `mobile/lib`, `mobile/app`, `mobile/components`, `mobile/types`, `mobile/config` | 538 | 6859 |
| `openapi` | `openapi.json`, `resources/openapi.json` | 2 | 221 |

- Unique field names across all readers: **40643**
- Names evidenced ONLY by test files: 3381
- Total occurrences indexed: 664663

## Files deliberately excluded

Every exclusion is a chance to hide a real reader, so each is named with its
reason rather than filtered silently.

- `react-frontend/src/resources.d.ts` — generated i18next translation-key interface — its keys are UI copy, not API fields

## How a field is judged

Three buckets, and the third is not optional:

| Bucket | Test | What it means |
| --- | --- | --- |
| IN SCOPE | the leaf name is in this manifest, and either has no informative parent or was seen in the same file as its parent object | a client reads it — this is the work queue |
| UNKNOWN | the name is read somewhere but never beside this parent; or the key is a dynamic map key; or the path was cut by the depth cap; or its ancestor list was empty on one side | the scan could not decide — treated **as in scope**, and labelled |
| OUT OF SCOPE | the name appears in no client and in no published contract | record the count and move past; Laravel serialising it is a **Laravel** defect |

🔴 **Why co-location.** Matching a field on its leaf name alone has almost no
discriminating power on a corpus generated from a client's own call list:
measured on the archived 195-path run, 669 of 733 differing field paths (91%)
had a leaf name appearing somewhere. Most matches were real, but some were
plainly spurious — `data.showcased_badges[].msg` matched `.msg` in the messages
conversation page, and `…[].threshold` matched the marketplace listing editor.
Neither page has ever seen a badge. So the manifest also records which file each
name was seen in, and the consumer asks the sharper question: is this leaf read
in the same file as the parent object it hangs off? A yes is strong evidence. A
no is **not** evidence of absence — it is reported as UNKNOWN and still treated
as in scope.

## The bias, stated plainly

This scan is **over-inclusive on purpose**. A field wrongly called in scope
costs a little wasted investigation. A field wrongly called out of scope hides
a real defect — which is the `starts_at` / `start_date` class of bug that
rendered an error page behind a wall of HTTP 200s. So every rule errs towards
claiming a reader exists, and any field path the scan cannot classify is
reported as UNKNOWN and treated as in scope.

## Known false positives (a name is listed but nothing really reads it)

- **Generic names.** `name`, `status`, `title`, `id` appear in every codebase
  for reasons unrelated to any API response.
- **Leaf-name matching.** A name read on one object counts as read on every
  object, because only the last path segment is matched.
- **Request bodies and local models.** A name written into a POST body, or
  belonging to a purely client-side type, is indistinguishable from a response
  read.
- **Nunjucks template variables.** Macro names, filters and route-invented
  locals are admitted alongside genuine field reads.
- **Tests.** Test files are scanned; see the test-only count above for how many
  names rest on that evidence alone.

## Known false negatives (something reads a field but it is not listed)

- **Dynamic property access.** `row[key]` with a variable key is invisible.
- **Spread-through code.** A response object passed whole into a component or
  a template with `{{ obj | dump }}` reads fields no rule can see.
- **Names shorter than two characters.**
- **Non-identifier keys.** Hyphenated or numeric map keys are not indexable as
  property names; the consumer reports these as UNKNOWN rather than guessing.
- **Unscanned surface.** Federation partner contracts and the sales site are
  not scanned. `openapi.json` covers the published contract only as far as its
  own schemas go.
- **Translation catalogues are deliberately not scanned** (`.json` is not in any
  client's extension list). `web-uk/src/lib/localization/generated/*.json` and
  the mobile `locales/` files hold UI copy keyed by names like
  `volunteer_hours` — the same false-positive class that made
  `react-frontend/src/resources.d.ts` an explicit exclusion. If a field is only
  ever named in a translation key, this manifest will not see it, and that is
  the intended behaviour.

## Regenerate

```bash
node aspnet-backend/scripts/build-consumed-field-manifest.mjs
```

The machine-readable manifest is `consumed-field-manifest.json`. It is consumed
by `aspnet-backend/scripts/lib/consumed-fields.mjs` and, through it, by
`compare-live-responses.mjs --consumed-fields`.

