// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/broker.json', import.meta.url)));

test('Irish Broker navigation uses safeguarding, moderation, and approval terminology accurately', () => {
  const shell = JSON.stringify({ sidebar: irish.sidebar, nav: irish.nav, breadcrumbs: irish.breadcrumbs });

  assert.doesNotMatch(shell, /Moderation|Faomhaí Meaitseála|Roghanna coimirce/u);
  assert.equal(irish.sidebar.section_moderation, 'Modhnóireacht');
  assert.equal(irish.nav.match_approvals, 'Faomhadh meaitseálacha');
  assert.equal(irish.nav.safeguarding_options, 'Roghanna cosanta');
  assert.equal(irish.breadcrumbs.monitoring, 'Monatóireacht úsáideoirí');
});

test('Irish Broker dashboard describes pending work, failures, and activity naturally', () => {
  const dashboard = JSON.stringify(irish.dashboard);

  assert.doesNotMatch(dashboard, /iarratais ar athbhreithniú a chosaint|úsáideoirí monatóireacht/u);
  assert.doesNotMatch(dashboard, /Síniú Isteach Nua|Tiocfaidh faomhaí|\bdais\b/u);
  assert.doesNotMatch(dashboard, /a chuireadh|cliste-meaitseála|\{\{count\}\}[nul] ó shin/u);

  assert.equal(irish.dashboard.new_signups_today, 'Clárúcháin nua inniu');
  assert.equal(irish.dashboard.partial_body, 'Tá fleasc á taispeáint ag cuntar amháin nó níos mó thuas toisc gur theip ar an iarratas bunúsach. Athnuaigh chun triail eile a bhaint as; má fhanann an fhleasc ann, seiceáil logaí an bhróicéara.');
  assert.equal(irish.dashboard.open_items_other, "míreanna ag fanacht le d'athbhreithniú");
  assert.equal(irish.dashboard.links.match_approvals_desc, 'Déan athbhreithniú ar mholtaí meaitseála cliste idir baill agus liostuithe.');
  assert.equal(irish.dashboard.links.messages_desc, 'Déan athbhreithniú ar chóipeanna bróicéara de chomhráite ar cuireadh bratach orthu.');
  assert.equal(irish.dashboard.time_hours_ago_other, '{{count}} uair ó shin');
});
