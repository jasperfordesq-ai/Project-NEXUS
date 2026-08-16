// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/public.json', import.meta.url)));

test('Irish public discovery, security, listings, FAQ and install copy stays context-aware', () => {
  const text = JSON.stringify(irish);

  assert.doesNotMatch(text, /polasaí iomlán um nochtadh|Aon leathanach cóirithe|póirseáil/u);
  assert.doesNotMatch(text, /Logáil Isteach Dhá-Fhachtóir agus Pasfhocail|eochracha pasanna WebAuthn/u);
  assert.doesNotMatch(text, /Preab postmharc|ritheann jabanna|Sleamhnáil trí liostaí/u);
  assert.doesNotMatch(text, /páirtnéireacht, comhpháirtíochta|suiteáil aon sconna|app shábháil/u);
  assert.doesNotMatch(text, /níos réidh le scrollú agus sconna|agus sconna "Cuir le Scáileán Baile"/u);

  assert.equal(irish.home.stats.active_listings, 'Liostálacha Gníomhacha');
  assert.equal(irish.home.audience_cards.defaults.exchange.cta, 'Brabhsáil Liostálacha');
  assert.equal(irish.faq.categories.getting_started.q3.step4_bold, 'Cruthaigh iarraidh');
  assert.equal(
    irish.features_page.groups.trust_reputation_and_safety.items.two_factor_and_passkeys.title,
    'Fíordheimhniú Dhá Fhachtóir agus Paseochracha',
  );
  assert.match(irish.features_page.groups.built_for_production.items.email_webhook_processing.description, /Postmark/u);
});
