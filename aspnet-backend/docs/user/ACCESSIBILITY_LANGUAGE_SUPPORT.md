# Accessibility, Language, And Support

Last reviewed: 2026-07-15

Status: **Maintained user reference - evidence limits stated explicitly**

## Accessible Service

The accessible browser experience uses the canonical
`/{tenantSlug}/accessible` mount. `/alpha` is redirect-only. The shared Web UK
implementation uses GOV.UK Frontend and design patterns, but Project NEXUS is
not a UK Government service and is not endorsed by GOV.UK.

Web UK currently has automated structural, axe, keyboard/focus, client-side
validation, narrow-reflow, no-JavaScript, and forced-colour checks over a finite
isolated fixture set. That is useful evidence, not a WCAG certificate. Directed
manual keyboard, zoom/reflow, forced-colour, visual, and screen-reader review is
still open, and the complete production service has not been certified against
all assistive-technology combinations.

Do not interpret phrases such as "built with semantic HTML" or a target of WCAG
2.2 AA as proof that every page has passed manual testing. The live evidence
boundary is recorded in
[the accessibility verification method](../../apps/web-uk/docs/ACCESSIBILITY_CERTIFICATION.md)
and [manual evidence register](../../apps/web-uk/docs/MANUAL_ACCESSIBILITY_EVIDENCE.md).

## Language

The maintained accessible catalog supports English, Irish, German, French,
Italian, Portuguese, Spanish, Dutch, Polish, Japanese, and Arabic. Availability
and completeness can still vary by page and tenant. Arabic uses a right-to-left
layout where implemented. Report untranslated keys, mixed-language pages, wrong
date/number formatting, or incorrect directionality with the selected language
and page address.

## Report An Accessibility Problem

Use the in-product Accessibility, Contact, Help Centre, or Report a Problem link
when available. Include:

- the community and page address;
- what you were trying to do;
- keyboard, browser, operating system, zoom level, and assistive technology;
- what you expected and what happened; and
- whether the problem prevents completion.

Do not include passwords, tokens, identity documents, private messages, or
another person's personal information. If a different format or human-assisted
route is required, ask the community contact shown by the service.

For repository defects, use [SUPPORT.md](../../SUPPORT.md). For a security
vulnerability, use [SECURITY.md](../../SECURITY.md).
