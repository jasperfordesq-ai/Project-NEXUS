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
