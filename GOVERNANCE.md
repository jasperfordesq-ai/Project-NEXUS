# Project Governance

This document describes how Project NEXUS is maintained and how decisions are made. It is intended to be honest about the project's current size while setting clear expectations for contributors, adopters, and the communities who depend on the platform.

## Project status

Project NEXUS is an open-source (AGPL-3.0-or-later) platform created and maintained by **Jasper Ford**, originating from the [hOUR Timebank CLG](https://hour-timebank.ie) community initiative. It is in active production use by real communities. The project is currently **maintainer-led**: a single steward holds final responsibility for direction, releases, and merges, supported by automated quality gates.

## Roles

| Role | Who | Responsibilities |
|------|-----|------------------|
| **Project Steward / Maintainer** | Jasper Ford | Final say on architecture, roadmap, releases, and merges to `main`. Owns the [CONTRIBUTOR_TERMS.md](CONTRIBUTOR_TERMS.md) and the [NOTICE](NOTICE) attribution terms. |
| **Code owners** | See [.github/CODEOWNERS](.github/CODEOWNERS) | Review authority over the areas they own. Required reviewers on pull requests. |
| **Contributors** | Anyone who submits an accepted change | Propose changes via pull request under the contributor terms. |
| **Adopters** | Communities running NEXUS | Use the platform, report issues, and influence priorities through feedback. |

## How decisions are made

- **Day-to-day changes** (bug fixes, docs, tests, incremental features) are decided by the maintainer and code owners through normal pull-request review.
- **Significant changes** (new modules, breaking API changes, dependency or architecture shifts, anything affecting tenant isolation, money movement, or AGPL attribution) should start as a [GitHub Discussion](https://github.com/jasperfordesq-ai/Project-NEXUS/discussions) or issue so the rationale and trade-offs are recorded before code is written.
- **Final authority** rests with the Project Steward. As the contributor base grows, this document will be updated to describe a broader decision-making model (e.g. a maintainers group with documented voting).

## Contribution flow

1. Open an issue or Discussion for anything non-trivial.
2. Read [CONTRIBUTING.md](CONTRIBUTING.md) and agree to [CONTRIBUTOR_TERMS.md](CONTRIBUTOR_TERMS.md) (enforced on every pull request — see [docs/CONTRIBUTOR_TERMS_ENFORCEMENT.md](docs/CONTRIBUTOR_TERMS_ENFORCEMENT.md)).
3. Submit a pull request. Automated gates (CI, security scanning, i18n drift, SPDX, accessibility, E2E smoke) and a code-owner review must pass.
4. The maintainer merges accepted changes to `main`.

## Quality and release standards

- Releases follow [.github/RELEASE_PROCESS.md](.github/RELEASE_PROCESS.md) and semantic versioning, anchored by the `VERSION` file.
- Every release-relevant change updates [CHANGELOG.md](CHANGELOG.md).
- Security is handled through the private process in [SECURITY.md](SECURITY.md).
- Documentation follows [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).

## Values

- **Tenant isolation and member trust come first.** Changes that touch tenant scoping, money movement, or personal data get the highest scrutiny.
- **Accessibility and internationalisation are not optional.** The platform targets WCAG 2.1 AA and ships user-facing text through translations.
- **The platform is global.** No locale-specific assumptions are baked into validation or defaults.
- **Open source obligations are honoured.** AGPL Section 7(b) attribution is preserved on every deployment.

## Continuity

Because the project currently depends on a single maintainer, continuity matters to the communities that rely on it:

- The full source is public under AGPL-3.0, so any community can continue to run, fork, and self-host the platform independently of the original maintainer.
- Production operations, deployment, incident response, and restore procedures are documented under [docs/](docs/README.md) so a competent operator can run the platform.
- If the maintainer becomes unavailable for an extended period, code owners and active contributors may coordinate continued maintenance of a fork consistent with the AGPL licence and the attribution terms in [NOTICE](NOTICE).

## Changing this document

Proposals to change the governance model should be raised as a Discussion. Until a broader model is adopted, changes are approved by the Project Steward.
