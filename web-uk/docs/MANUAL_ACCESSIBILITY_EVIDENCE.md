# Web UK manual accessibility evidence

Status: **Maintained reference — evidence register, not a conformance claim**

This register records directed browser and assistive-technology checks separately from the automated accessibility gate. An entry is evidence only for the exact page, browser, input method, viewport, and state listed. It is not a claim of WCAG conformance.

`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` is the current safety and scoring
source. Any historical entry below that authenticated, submitted a form, or
otherwise wrote state while using the ordinary Laravel environment at
`127.0.0.1:8088` is invalid as runtime certification. It is retained only as
UI-regression discovery. Future stateful manual evidence requires a separately
provisioned and verified disposable Laravel application/database/storage
environment; authorization and cleanup never permit writes to the ordinary
production-derived snapshot.

## 2026-07-12 - English sign-in error recovery

- Page: `http://127.0.0.1:5181/hour-timebank/accessible/login`
- Build: Web UK commit `dfead143`, using an isolated local listener and Laravel at `http://127.0.0.1:8088`
- Browser: Codex in-app browser; Chromium engine/version was not exposed by the inspection surface
- Assistive technology: none
- Input: browser-assisted pointer activation and focus inspection
- Viewports: default browser viewport and `320 x 640`

Observed outcomes:

- The English page exposed one main landmark, the `Sign in` level-one heading, labelled email and password fields, cookie controls, the skip link, service navigation, and footer navigation.
- Activating the empty sign-in form created one focused `role="alert"` GOV.UK error summary with `tabindex="-1"`.
- The summary contained two links, targeting `#email` and `#password`. The fields referenced `email-error` and `password-error` through `aria-describedby`.
- Activating the email-summary link moved focus to the email field.
- At `320 x 640`, the error state remained present and the document had no horizontal overflow (`scrollWidth 305`, `clientWidth 305`).

Limitations and open evidence:

- The in-app browser's keyboard-injection path did not dispatch Tab or Enter during this inspection. This entry therefore does **not** count as a manual keyboard-only pass. The repository's Playwright accessibility gate separately exercises cookie-control order, the skip link, summary focus, and error-link focus with keyboard input.
- No screen reader, magnifier, speech input, switch control, or representative disabled user was involved. Those checks remain open.
- Browser-engine/version diversity, 200% and 400% zoom, and operating-system high-contrast behavior remain open manual checks.

## 2026-07-12 - English accessibility statement and skip-link presentation

- Page: `http://localhost:5350/hour-timebank/accessible/accessibility`
- Build: Web UK commit `e5bdb73e`, using an isolated local listener and Laravel at `http://127.0.0.1:8088`
- Browser: Codex in-app browser; Chromium engine/version was not exposed by the inspection surface
- Assistive technology: none
- Input: browser-assisted focus and responsive-layout inspection
- Viewports: default browser viewport and `320 x 800`

Observed outcomes:

- The default-English page exposed the accessibility statement as one main landmark with the expected heading hierarchy, legal back link, feedback link, service navigation, and footer navigation.
- At the narrow viewport, the skip link was the first focusable element in document order. Its target existed as `<main id="main-content" tabindex="-1">`.
- Focus inspection exposed the skip link at the top of the viewport with a 40 CSS-pixel height, yellow background and outline (`rgb(255, 221, 0)`), and near-black text (`rgb(11, 12, 12)`).
- At 320 CSS pixels, the document had no horizontal overflow (`scrollWidth 305`, `clientWidth 305`), while the responsive menu and statement content remained visible.

Limitations and open evidence:

- The in-app browser's keyboard-injection path again did not advance focus with Tab or activate the focused link with Enter. This entry therefore does **not** count as a manual keyboard-only pass. The repository's Playwright gate remains the keyboard automation evidence for the skip-link journey.
- No screen reader, magnifier, speech input, switch control, or representative disabled user was involved. Assistive-technology certification remains open.
- Browser-engine/version diversity, zoom, forced-colour, and operating-system high-contrast checks remain open.

## 2026-08-10 - Keyboard traversal, skip link, and error-summary recovery (first real Tab/Enter evidence)

- Pages: `/hour-timebank/accessible/login` and `/hour-timebank/accessible/register`
- Build: repository `main` at `b9e38a303`, plus the uncommitted `mobile-nav.js` removal recorded below
- Server: isolated Web UK fixture via `npm run manual:accessibility:isolated`. The paired mock backend answers **GET/HEAD only** and returns 405 on any other method, recording it as a gate failure. **No Laravel environment was contacted and no state was written.**
- Browser: Claude Code in-app Browser pane, Chromium `Chrome/148.0.0.0`
- Assistive technology: none
- Input: real dispatched `Tab` and `Enter` key events, plus one pointer activation explicitly labelled below
- Viewports: `1280 x 720` (keyboard work), `640 x 800` and `320 x 640` (reflow)

Observed outcomes:

- **Tab traversal now works, closing the gap both 2026-07-12 entries recorded.** A 34-stop traversal of the default-English login page was captured from real `Tab` presses via a `focusin` recorder. Order: three cookie-banner controls, skip link, service name, locale `select` plus its `Change` button, eight primary navigation links, `Give feedback`, then `main` content (`#email`, `#password`, `Forgot your password?`, `Sign in`, `Register for an account`), then footer navigation.
- **Every one of the 34 stops had a visible focus indicator** (`anyInvisibleFocus` empty): GOV.UK yellow `rgb(255, 221, 0)`, a `box-shadow` ring on inputs, or an outline on the service-name link. No stop was invisible or zero-size.
- Focus order matched visual order. The only two backward vertical movements were the footer's three columns being traversed column-by-column (`x152`, then `x482`, then `x812`), which is correct reading order, not a focus-order defect.
- **Skip link, by keyboard:** with focus on `Skip to main content`, a real `Enter` moved focus to `<main id="main-content" tabindex="-1">` and scrolled to it (`scrollY 449`). The **next** `Tab` landed on `#email` *inside* `main` — so the skip genuinely relocates the tab sequence rather than only jumping the scroll position.
- `#email` is correctly associated with `<label class="govuk-label govuk-label--m" for="email">Email address</label>`.
- **Error-summary recovery, by keyboard:** with a summary present, `Tab` reached its first link (`href="#email"`) and a real `Enter` moved focus to `#email`, which showed a visible focus ring (`outline solid 2.4px rgb(255, 221, 0)` plus inset `rgb(11, 12, 12)` shadow) and carried `aria-describedby="email-error"` resolving to `Error: Enter a valid email address`.
- Field-level errors are also produced by the `blur` handler independently of submission, so tabbing off an empty required field already exposes its error and description.
- **Reflow:** no horizontal overflow on login or register at either `640 x 800` (200% zoom equivalent) or `320 x 640` (400% equivalent) — `scrollWidth` equalled `clientWidth` in all four combinations, with `body` `overflow-x: visible`, so the pages genuinely fit rather than clipping.
- Register at `320 x 640` exposed 14 non-hidden fields, **all** with a resolving label, and two `fieldset`/`legend` groupings.
- **Collapsed mobile navigation is correctly removed from the tab order:** the toggle exposed `aria-expanded="false"` with `aria-controls="alpha-navigation"` resolving, and of the 8 links inside, **0** were focusable while collapsed.
- **Registration honeypot verified correct, not a defect.** `#website` sits in a wrapper carrying `aria-hidden="true"` with `position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%)`, and the input itself carries `tabindex="-1"` and `autocomplete="off"`, with a `Website (leave blank)` label as a CSS-failure fallback. Screen-reader users do not encounter it and keyboard users cannot reach it. A naive overflow probe reports this input at `right=327` on a 320-pixel viewport; that is the child measured inside its 1px clipping wrapper, and the document does not scroll.

Fix applied during this session:

- **Removed `public/js/mobile-nav.js` and its `<script>` tag** (`src/views/layouts/base.njk`). The file queried `.js-header-toggle` and `.js-header-navigation`, **neither of which exists anywhere in the repository**, so both `querySelector` calls returned `null` and its entire body — including its mobile focus-management and `Escape`-to-close logic — never executed. It was loaded on every page (2,319 bytes) and had no test coverage. The live toggle is GOV.UK Frontend's own `govuk-js-service-navigation-toggle`, which the Laravel Blade layout uses with byte-identical markup (`views/layout.blade.php:141`), and Blade's `src/app.ts` contains **no** keydown handlers. `govuk-frontend.min.js` contains **zero** occurrences of `Escape`. Observable behaviour is therefore unchanged and Blade parity is preserved; `Escape`-to-close never worked in either frontend, so this removes dead weight rather than a feature. After removal: isolated accessibility gate **24/24**, Jest **59 suites / 1,787 tests**, and a fresh server serves five scripts instead of six with `aria-expanded`, `aria-controls` and the 0-of-8 focusable result all unchanged.

Limitations and open evidence:

- 🔴 **Synthesised `Enter` cannot submit a form or activate a `button` in this harness.** The event arrives `isTrusted: true` but with `keyCode: 0`, so Chromium delivers it to JavaScript without running implicit form submission or button activation. A capture-phase listener counted `submit` **0** times for `Enter` on both `#email` and the `Sign in` button, and **1** time for a pointer click. This is a harness artefact, **not** a product defect: the pointer click produced a correct `role="alert"`, `tabindex="-1"`, focused `.govuk-error-summary` titled `There is a problem` with two links resolving to `#email` and `#password`. `Enter` on **links** works normally, which is why the skip-link and summary-link journeys above are valid keyboard evidence. **Keyboard activation of submit buttons therefore remains unproven and must be re-run on a harness that emits a real `Enter`.**
- The `320 x 640` measurements ran under the pane's automatic mobile emulation (Android `Pixel 8` user agent, touch input), so they are narrow-viewport reflow evidence, not desktop-zoom evidence, and hover states were not exercised at that width.
- **No screenshot comparison was captured.** The Browser pane was not displayed, so the compositor produced no frames: `screenshot` timed out after 5s and coordinate clicks were refused. Pointer activation by element reference also began timing out at the narrow viewport. Representative visual review therefore remains open and needs the pane displayed.
- Operating-system **forced-colours / high-contrast** was not manually exercised; `matchMedia('(forced-colors: active)')` reported `false` throughout. The automated gate's forced-colour case passes, which is not a manual result.
- **No screen reader was used, so no speech-output sign-off is claimed.** Name/role/state inspection is not equivalent to hearing what NVDA, JAWS or VoiceOver announces, and this gate needs a human running one.
- This entry records evidence only. **No score was moved**: the `663/1000` W1 bank and the `35/150` manual-accessibility row are unchanged, and assigning any W2 percentage remains the separate fixed-rubric certification transaction.

## Authenticated accessibility gate — first execution, 2026-08-19

🔴 **These 59 checks existed but had never run.** The CI job runs the ISOLATED
variant, whose runner greps three describes only
(`scripts/accessibility-isolated-selection.js`); the authenticated, Irish and
Arabic RTL gates were never in that selection, and the full `test:accessibility`
aggregate needs a real backend, which must not be pointed at the shared local
database. So the signed-in pages — the ones members actually spend their time on
— had no automated axe, reflow or RTL coverage at all on a frontend whose entire
reason for existing is accessibility.

**Result of the first run:** 52 passed, 7 skipped, 0 failed, against the
disposable environment (Laravel :8092, tenant `e2e-community`, synthetic
accounts only). Each check loads the page at a 320px viewport, asserts one
`<main>` / one `#main-content` / one `<h1>` / a service navigation, asserts no
horizontal overflow, and runs axe, failing on any serious or critical violation.

**What the first run found — all in the tests, not the pages:**
- Five paths carried ids from another environment (`77`, `636`, `162`). They are
  now `ACCESSIBILITY_MEMBER_ID`, `ACCESSIBILITY_ORG_ID` and
  `ACCESSIBILITY_GOAL_ID`, defaulting to the original values so nothing changes
  for the environment they were written against.
- The block was `mode: 'serial'`, so the first fixture 404 skipped the other 37
  checks. It is now `default`; the tests are independent.
- Two assertions looked for `main .govuk-caption-l`, which stopped existing when
  the captions were standardised on `caption-xl`. They broke silently because
  this suite never runs.
- One asserted `maxlength="500"` on a character-counted textarea. govuk-frontend
  REMOVES that attribute when its JavaScript initialises
  (`character-count.mjs:94`), deliberately, so a member can type past the limit
  and get a real error. The no-JS guarantee is already covered at source level by
  `character-count-contract.test.js`; the runtime check now proves the enhanced
  component initialised instead.
- One asked a standard poll for its ranked-choice ballot and expected success;
  the API correctly answers 400. It now picks a poll the page itself marks as
  ranked.
- The knowledge-base check assumed at least one article. An empty library is a
  legitimate state and the page still has to be accessible in it.

**The 7 skips are honest, not silenced:** five organisation pages and one goal
page (`ACCESSIBILITY_ORG_ID=none`, `ACCESSIBILITY_GOAL_ID=none` — this backend
has neither seeded) and one ranked-choice poll. A skip requires an explicit
environment declaration; a 404 still fails.

**Repeat it:**

```bash
bash scripts/webuk-e2e-env.sh up   # from the repository root
LARAVEL_BASE_URL=http://127.0.0.1:8091 \
SMOKE_EMAIL=e2e.user.a@project-nexus.local SMOKE_PASSWORD='TestPassword123!' \
SMOKE_TENANT=e2e-community ACCESSIBILITY_TENANT_SLUG=e2e-community \
ACCESSIBILITY_MEMBER_ID=<a member OTHER than the one signed in> \
ACCESSIBILITY_ORG_ID=none ACCESSIBILITY_GOAL_ID=none \
npm --prefix web-uk run test:accessibility:authenticated
```

🔴 `ACCESSIBILITY_MEMBER_ID` must not be the signed-in member: the appreciation
wall renders its form only `{% if not isSelf %}`.

### Irish and Arabic RTL gates — also first execution, same date

The same CI selection excludes `Irish narrow reflow and catalogue gate` and
`Arabic RTL and narrow reflow gate`. Both were run against the same disposable
environment on 2026-08-19: **13 passed, 0 failed**, no changes needed. Repeat
with `--grep="narrow reflow"` in place of the authenticated grep above.

🔴 **CI still does not run any of these three gates.** The isolated fixture
cannot serve them — they need a real backend — and wiring the disposable Laravel
into the workflow is a separate piece of infrastructure work. What has changed is
that they are now known to pass, the fixture assumptions that made them
unrunnable are gone, and there is a documented command that works. Treat this as
evidence for the date and environment named, not as continuous coverage.

## The one thing none of this can do

Everything above is a machine checking a machine. The largest single deduction
in the score — **-30, no screen-reader speech-output sign-off** — cannot be
closed from this repository at all, because axe and reflow checks catch roughly
a third of real barriers and none of them can tell you whether a blind member
can finish a task. [SCREEN_READER_TEST_PACK.md](SCREEN_READER_TEST_PACK.md) is
the instrument for closing it: seven journeys, about an hour, written for
somebody who has never used a screen reader, with the machine-checked ground
deliberately excluded so the human effort goes where it counts.
