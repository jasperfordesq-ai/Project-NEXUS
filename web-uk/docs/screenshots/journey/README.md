# Signed-in journey screenshots

Visual evidence for the pages members actually spend their time on, captured at desktop
(1280px) and at the GDS reflow width (320px).

Regenerate with, from the repo root then `web-uk/`:

```bash
bash scripts/webuk-e2e-env.sh up
npm --prefix web-uk run visual:journey
```

## Why these could not exist before

Until the disposable journey environment was built, the only database available locally
was a copy of the live platform. Any screenshot of a signed-in page therefore contained
real members' names and messages, and this repository is public — so there was no visual
record of the pages that matter most.

Every account, listing and community shown here is invented. `E2E UserA` and
`E2E Test Community` are fixtures, not people or places.

## The capture refuses to run against real data

`scripts/capture-webuk-journey-screenshots.js` stops before taking a single image unless
**both** of these hold:

1. Every account in the target database has a synthetic address.
2. The signed-in page renders the synthetic member's name.

Either one failing is a hard stop. Do not weaken these — they are the only thing standing
between this directory and a public commit of real members' data.

## Reading the manifest

`manifest.json` records the URL, HTTP status, and whether the page scrolled horizontally
at 320px for each image. Horizontal scrolling at that width is a WCAG 2.2 §1.4.10 failure,
so it is recorded as a fact rather than left to the eye. At the last capture, all twenty
pages returned 200 and none scrolled horizontally.

The manifest deliberately carries **no timestamp**. These files are committed, and a
generated timestamp would produce a diff on every run even when nothing had changed.
