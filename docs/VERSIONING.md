# Versioning Policy

Last reviewed: 2026-08-29

Project NEXUS versions the platform with [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
This page is the authoritative statement of what each number means here, how to
choose one, and which parts are machine-enforced rather than left to judgement.

`VERSION` at the repository root is the canonical value. Every other place the
version appears is derived from it and pinned by
[`scripts/check-version-consistency.mjs`](../scripts/check-version-consistency.mjs).

---

## The three numbers

A version is `MAJOR.MINOR.PATCH` — in `1.7.0`, major 1, minor 7, patch 0.

| Part | Increment when | Reset |
|---|---|---|
| **MAJOR** | A change breaks something a consumer already depends on. | minor and patch to `0` |
| **MINOR** | New functionality is added and nothing existing breaks. | patch to `0` |
| **PATCH** | Only fixes, security work, or internal changes. Nothing new, nothing broken. | — |

### These are numbers, not digits

There is no carry at nine. `1.6.9` is followed by `1.6.10`, then `1.6.11`,
`1.6.12`, and so on for as long as only fixes ship. A two-digit patch component
is normal and correct.

This is worth stating explicitly because the release history before `1.7.0` rolled
over instead: `1.5.9` was followed by `1.6.0` with no feature-based reason for the
minor bump. Under this policy that would have been `1.5.10`.

A consequence worth internalising: **under this policy the leading numbers grow
more slowly, not faster.** MAJOR moves only on a breaking change, which for a
platform of this shape is a rare and deliberate event. The odometer behaviour it
replaces reached a new MAJOR every hundred releases regardless of whether anything
significant had happened, which made the number carry no information.

---

## What counts as "breaking" here

Semantic Versioning is a promise to whoever depends on your published surface, so
the rule is only as meaningful as the list of surfaces. For this platform they are:

| Consumer | Depends on |
|---|---|
| `react-frontend/` | The Laravel V2 API response contracts |
| `mobile/` (Expo) and the Capacitor wrapper | The same V2 API, pinned by the mobile consumer ledger |
| `web-uk/` (accessible frontend) | The same V2 API, plus the `govuk_alpha*` translation catalogues |
| External federation partners | The federation API and its protocol version |
| Self-hosting operators | Environment variables, the deployment scripts, the database schema, and the documented upgrade path |
| Anyone reading `SECURITY.md` | Which versions receive security fixes |

A change is **breaking** — and therefore MAJOR — when it would require one of
those consumers to change something in order to keep working:

- Removing or renaming a field a client reads, or changing its type or meaning.
- Removing an endpoint, or narrowing who may call one.
- Removing or renaming an environment variable the deployment requires, or
  changing its default in a way that alters behaviour.
- A database migration that cannot be applied to an existing installation, or
  that cannot be rolled back without data loss.
- Removing a translation namespace another component generates from.
- Raising a minimum requirement: PHP, Node, MariaDB, or the federation protocol.

A change is **not** breaking merely because it is large, risky, or touches many
files. Adding a field, adding an endpoint, adding an optional environment
variable with a safe default, or fixing behaviour that never worked are all
additive or corrective.

> **Fixing a bug is a PATCH even when the fixed behaviour is the opposite of the
> broken behaviour.** Restoring documented behaviour is not a breaking change. If
> callers had come to rely on the broken behaviour, say so in the changelog entry;
> that is a note, not a MAJOR bump.

---

## Choosing the number

Work down this list and stop at the first match. The gate applies the same order.

1. Does any entry in the release describe a breaking change? → **MAJOR**
2. Does the release add functionality that did not exist? → **MINOR**
3. Otherwise → **PATCH**

Because the changelog is the evidence, the release section's own structure decides
the answer:

| The new changelog section contains | Minimum required bump |
|---|---|
| Any entry marked `**BREAKING:**` | MAJOR |
| An `### Added` subsection with at least one entry | MINOR |
| Anything else | PATCH |

### The subsection vocabulary

Only these headings are permitted in a release section, and the gate rejects
anything else. That is not tidiness: `### New`, or a lower-case `### added`,
would silently dodge the MINOR rule, which is worse than having no rule.

| Heading | For | Drives the bump? |
|---|---|---|
| `### Added` | New functionality a consumer can observe | **Yes — MINOR** |
| `### Changed` | Existing behaviour works differently | No |
| `### Deprecated` | Still works, scheduled for removal | No |
| `### Removed` | Gone. Mark `**BREAKING:**` if a consumer used it | No (the marker does) |
| `### Fixed` | Bugs | No |
| `### Security` | Vulnerabilities and hardening. **Security work only** | No |
| `### Internal` | Developer tooling, CI gates, test harnesses, refactors | No |

`### Notes` and `### Documentation` were used before this policy and are retired.
They are accepted in sections below the enforcement floor and rejected above it.

#### Why `### Internal` exists

This changelog documents developer tooling alongside member-facing work. Filing a
new CI gate under `### Added` would force a MINOR bump for something no consumer
can observe — and if every release does that, MINOR stops meaning "new
functionality" and the number goes back to carrying no information.

> 🔴 The obvious abuse is filing a real feature under `Internal` to avoid a MINOR
> bump. No checker can detect that. The test is the one in the consumer table
> above: **could any of those consumers observe this change?** If yes, it is not
> internal, whatever it took to build.

#### Keep `### Security` for security

`### Security` is for vulnerabilities and hardening, nothing else. It had drifted
badly by 1.7.0 — fourteen entries about date formatting, Podcasts, Courses and an
admin audit-log crash sat under it, which made the release look as though it
carried twenty-two security fixes when it carried three. A reader scanning for
security work has to be able to trust that heading.

### Marking a breaking change

Breaking changes are not inferable from a subsection heading — a `### Removed`
entry may be dead internal code or may be a field a client reads. So they are
declared explicitly. Begin the entry with the literal marker:

```markdown
### Removed

- **BREAKING:** `GET /v2/listings` no longer returns the `legacy_category` field.
  Clients should read `category.slug`. Present since 1.2.0, deprecated in 1.6.0.
```

The marker is what the gate looks for. An entry that describes a breaking change
without it will let a MAJOR-worthy release ship as MINOR, which is the failure the
whole policy exists to prevent — so treat adding the marker as part of making the
change, not as release paperwork.

### Deprecation before removal

Removing a consumed surface is a MAJOR change. To avoid accumulating them, deprecate
first: keep the old surface working, document it as deprecated in the same release
that introduces the replacement (a MINOR), and remove it in the next MAJOR. A
deprecation is itself additive and never forces a MAJOR bump.

---

## Pre-release and build metadata

Semantic Versioning allows a suffix for versions that are not yet final:
`1.8.0-rc.1` sorts *before* `1.8.0`. The repository has used this once already
(`1.5.0-rc.1`). Both `check-version-consistency.mjs` and the policy gate accept
pre-release identifiers and order them correctly.

Build metadata (`1.8.0+abc1234`) is permitted by the spec but is **not used here**.
Deployment builds are identified by commit SHA, which is what Sentry releases and
the blue/green deploy scripts key on. Do not put a build id in `VERSION`.

---

## Cutting a release

Use the release tool. It exists because a release touches thirty-six files, and
doing that by hand is how entries get stranded and how a partial bump ships.

```bash
# See what would happen — no files are written.
node scripts/release.mjs --dry-run

# Cut it. The bump type is derived from the changelog and must be confirmed.
node scripts/release.mjs --minor
```

The tool will:

1. Refuse to run on a dirty working tree, or off `main`.
2. Read the `[Unreleased]` section and derive the **minimum** required bump.
3. Refuse if the bump you asked for is smaller than the changelog justifies.
4. Move `[Unreleased]` into a new dated section and leave `[Unreleased]` empty.
5. Update `VERSION` and every derived reference.
6. Add the compare link.
7. Regenerate the in-app changelog copy.
8. Create an annotated git tag `vX.Y.Z`.

It does **not** push and does **not** deploy. Both remain deliberate, separate
actions — see the deployment rules in [AGENTS.md](../AGENTS.md).

### Tags

Every released version has an annotated tag `vX.Y.Z` on the commit that cut it.
The tags are what the changelog's compare links resolve against; without them
every one of those links is a 404.

Tags are pushed explicitly:

```bash
git push origin vX.Y.Z
```

---

## What is enforced

| Check | Enforces | Where |
|---|---|---|
| `npm run check:version` | Every derived reference matches `VERSION`. | CI (blocking), preflight |
| `npm run check:semver` | `VERSION` is valid semver; releases are strictly ordered with real dates; the bump matches the changelog; subsection headings are from the defined vocabulary; no entry floats outside a subsection; every release has a tag and a compare link. | CI (blocking), preflight |
| `npm run test:semver-gate` | That the gate above still catches all of the above — seventeen fixtures, in both directions. | CI (blocking), preflight |
| `node scripts/check-changelog-updated.mjs` | Release-relevant changes carry a changelog entry. | CI (blocking), preflight |

The gate's own tests exist because this repository has twice shipped a checker
that enforced nothing — one whose comment claimed it pinned a value while it
pinned nothing, and a bundle-size budget that was written but never invoked. A
gate nobody has watched fail is not evidence.

`check-semver` uses the [`semver`](https://github.com/npm/node-semver) package —
the reference implementation maintained by npm — rather than hand-rolled string
comparison, so pre-release ordering and edge cases behave the way the spec says.

---

## Honest history

**This policy is enforced from `1.7.0` onward.** The releases before it do not
conform, and the gate deliberately does not judge them.

Both `1.6.1` and `1.6.2` shipped an `### Added` subsection as PATCH releases, and
`1.6.0` was a MINOR bump produced by rolling over from `1.5.9` rather than by the
content of the release. Those numbers are already published in the changelog and
in the app; renumbering them would break the historical record to no benefit.

The enforcement floor is a constant in
[`scripts/check-semver-policy.mjs`](../scripts/check-semver-policy.mjs). Lowering
it is not a way to make a failure go away — a failure below `1.7.0` means the
history has been edited.

---

## Related

- [CI.md](CI.md) — the pipeline and which checks block a merge.
- [DEPLOYMENT.md](DEPLOYMENT.md) — how a release reaches production, and why a version bump is not a deployment.
- [../CHANGELOG.md](../CHANGELOG.md) — the release history itself.
