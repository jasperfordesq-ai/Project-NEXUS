# Contributor Terms Enforcement

Last reviewed: 2026-07-14

Project NEXUS uses three layers to make contributor-terms acceptance hard to miss and hard to bypass accidentally.

## Layer 1: Pull Request Template

`.github/pull_request_template.md` includes a mandatory Contributor Terms section. GitHub automatically places this content into the body of new pull requests opened through the GitHub web interface.

Contributors must check the acknowledgement boxes and complete the disclosure fields before the PR can pass the automated check.

## Layer 2: Blocking PR Check

`.github/workflows/contributor-terms.yml` contains the `Contributor Terms Acceptance` job. The job runs on pull requests to `main` when a PR is opened, edited, updated, reopened, or marked ready for review.

Bot-authored pull requests and pull requests authored by the repository owner are exempt: a bot cannot accept legal terms, and the owner is already the licensor. All other contributors must satisfy the fields below.

The job fails unless the PR description includes:

- the `## Contributor Terms` section;
- a checked acknowledgement for `CONTRIBUTOR_TERMS.md`;
- a checked ownership or employer-authorisation acknowledgement;
- a checked AI contribution disclosure acknowledgement;
- a completed `Third-Party Material Disclosure` field;
- a completed `AI Contribution Disclosure` field.

The check uses `pull_request_target` so the workflow is read from the base repository, not from the contributor's branch. It reads only pull request metadata, does not check out contributor code, does not execute contributor code, and does not request `GITHUB_TOKEN` permissions.

## Layer 3: Code Ownership

`.github/CODEOWNERS` assigns Jasper Ford as owner of the licensing, attribution, contributor-intake, and PR-check files.

To make this layer enforceable on GitHub, enable branch protection or a repository ruleset for `main` with:

- require a pull request before merging;
- require status checks to pass before merging;
- require the `Contributor Terms Acceptance` status check;
- require review from Code Owners;
- do not allow bypassing the rules unless deliberately needed by the repository owner.

GitHub repository settings, not files in the repository, control whether failed checks and Code Owner reviews block merging. The workflow provides the check; the repository ruleset makes it mandatory.

## Applying The Ruleset

After these files are pushed to GitHub, run:

```bash
gh auth login -h github.com
node scripts/configure-contributor-terms-ruleset.mjs --repo jasperfordesq-ai/Project-NEXUS
```

The script creates or updates a repository ruleset named `Project NEXUS contributor terms gate`. It protects `main` by requiring:

- pull requests before merging;
- one approving review;
- Code Owner review;
- approval from someone other than the last pusher;
- all review threads resolved;
- the `Contributor Terms Acceptance` status check;
- branch up to date with `main` before merge;
- no branch deletion;
- no force-pushes.

Use `--dry-run` to inspect the API payload without changing GitHub:

```bash
node scripts/configure-contributor-terms-ruleset.mjs --repo jasperfordesq-ai/Project-NEXUS --dry-run
```
