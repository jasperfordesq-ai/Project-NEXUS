# Third-Party Notices

Project NEXUS is licensed under **AGPL-3.0-or-later** (see [LICENSE](LICENSE) and
[NOTICE](NOTICE)). It also bundles third-party open-source components, each of which
remains under **its own** licence and copyright. This file records those components
and satisfies the "retain the copyright notice and licence text on redistribution"
condition of their permissive (BSD / MIT / Apache / ISC) licences.

- The **full, machine-generated production inventory** (every npm + Composer
  dependency, version, licence, source URL) is in
  [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
- Regenerate and re-audit with: `node scripts/check-licenses.mjs --write`
  (or `npm run licenses:write`). `npm run check:licenses` runs the same audit
  **without** `--write`, so it verifies licences but does not refresh the
  inventory. The audit **fails** if a new strong-copyleft (GPL/AGPL/SSPL)
  dependency is introduced.

## Production dependency licence summary

| Ecosystem | Packages | Licence spread |
|---|---|---|
| npm (browser frontend) | 397 | MIT (325), Apache-2.0 (29), ISC (23), BSD-3 (12), BSD-2 (2), 0BSD/Unlicense, `MIT AND Zlib`, `MIT AND ISC`; `MPL-2.0 OR Apache-2.0` (DOMPurify → elect Apache-2.0) |
| Composer (PHP backend) | 120 | MIT-dominant, plus BSD-3 / Apache-2.0 / BSD-2 / ISC and the dual/tri-licensed items noted below |

**No pure GPL/AGPL licence appears in either tree.** The Composer tree has no
strong-copyleft-only dependency after removing `rubix/ml` (an optional, `class_exists`-guarded
accelerator that transitively pulled `wamania/php-stemmer` → `joomla/string`, GPL-2.0).

## Highlighted components

The newsletter email builder and the wider platform build on, among others:

| Component | Licence | Source |
|---|---|---|
| **GrapesJS** (drag-and-drop builder core) | BSD-3-Clause | <https://github.com/GrapesJS/grapesjs> |
| **GrapesJS webpage preset and plugins** (CMS page builder blocks, forms, tooltips, custom code) | BSD-3-Clause | <https://github.com/GrapesJS/preset-webpage>, <https://github.com/GrapesJS/blocks-basic>, <https://github.com/GrapesJS/components-forms>, <https://github.com/GrapesJS/components-tooltip>, <https://github.com/GrapesJS/components-custom-code>, <https://github.com/artf/grapesjs-tabs> |
| **grapesjs-mjml** (MJML mode) | BSD-3-Clause | <https://github.com/GrapesJS/mjml> |
| **MJML / mjml-browser** (email markup compiler) | MIT | <https://github.com/mjmlio/mjml> |
| **React** | MIT | <https://github.com/facebook/react> |
| **HeroUI** | MIT | <https://github.com/heroui-inc/heroui> |
| **Tailwind CSS** | MIT | <https://github.com/tailwindlabs/tailwindcss> |
| **Lucide** (icons) | ISC | <https://github.com/lucide-icons/lucide> |
| **Sentry JavaScript** | MIT | <https://github.com/getsentry/sentry-javascript> |
| **Expo Clipboard / Expo Crypto / Expo FileSystem** (mobile credential actions and authenticated offline storage) | MIT | <https://github.com/expo/expo> |
| **React Native QR Code SVG** (mobile attendee credential rendering) | MIT | <https://github.com/Expensify/react-native-qrcode-svg> |
| **TweetNaCl.js** (mobile authenticated secretbox and Ed25519 verification) | Unlicense | <https://github.com/dchest/tweetnacl-js> |
| **Leaflet** (maps) | BSD-2-Clause | <https://github.com/Leaflet/Leaflet> |
| **DOMPurify** | MPL-2.0 OR Apache-2.0 | <https://github.com/cure53/DOMPurify> |
| **Laravel framework** | MIT | <https://github.com/laravel/framework> |
| **Symfony components** | MIT | <https://github.com/symfony> |
| **sabre/vobject** (RFC 5545 recurrence and iCalendar processing), **sabre/xml**, **sabre/uri** | BSD-3-Clause | <https://github.com/sabre-io/vobject>, <https://github.com/sabre-io/xml>, <https://github.com/sabre-io/uri> |

The GrapesJS name and logo are trademarks of their respective owners; per BSD-3-Clause
they are **not** used to endorse or promote Project NEXUS.

## Licence elections and notes

Where a dependency offers a choice of licences ("A OR B"), Project NEXUS elects the
permissive option:

- **DOMPurify** — `MPL-2.0 OR Apache-2.0` → **Apache-2.0**.
- **nette/schema**, **nette/utils** — `BSD-3-Clause OR GPL-2.0 OR GPL-3.0` → **BSD-3-Clause**.
- **james-heinrich/getid3** — `GPL-1.0-or-later OR LGPL-3.0-only OR MPL-2.0` → **MPL-2.0**
  (weak/file-level copyleft; usable in proprietary distributions with file-level obligations).

The frontend integrates the BSD-2-Clause **Leaflet** API directly. The former
`react-leaflet` / `@react-leaflet/core` wrapper dependency was removed because its
Hippocratic-2.1 field-of-use restriction is not an OSI-approved open-source licence
and was unnecessary for the map implementation.

**No strong-copyleft (GPL/AGPL) dependency remains.** The previously-tracked
`joomla/string` (GPL-2.0-or-later) was removed by dropping `rubix/ml` — an optional
ML accelerator that was only ever used behind a `class_exists()` guard with a
pure-PHP fallback, so removing it is behaviour-preserving. The audit gate
(`scripts/check-licenses.mjs`, `KNOWN_EXCEPTIONS = {}`) now fails on any *new*
strong-copyleft dependency.
