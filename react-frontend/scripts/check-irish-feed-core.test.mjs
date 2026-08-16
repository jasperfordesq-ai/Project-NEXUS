// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/feed.json', import.meta.url)));

test('Irish Feed core discovery, moderation and realtime wording rejects known semantic failures', () => {
  const catalogue = JSON.stringify(irish);

  assert.doesNotMatch(catalogue, /liostáin|vótaíochtaí|Cruthaigh vóta/u);
  assert.doesNotMatch(catalogue, /cumadóir dréachta|á luchtú|scagairí beatha|scagaire beatha/u);
  assert.doesNotMatch(catalogue, /moderadóirí|balbhaithe|bhalbhú|gceanúlacht/u);
  assert.doesNotMatch(catalogue, /m\.sh\.,|Réamhamharc liostála/u);

  assert.equal(irish.subtitle, 'Féach cad atá ag tarlú i do phobal');
  assert.match(irish.meta_description, /liostuithe/u);
  assert.match(irish.meta_description, /pobalbhreitheanna/u);
  assert.equal(irish.create_poll_aria, 'Cruthaigh pobalbhreith');
  assert.equal(irish.filter.clear, 'Glan scagairí an fhotha');
  assert.match(irish.report.description, /modhnóirí/u);
  assert.equal(irish.toast.user_muted, 'Cuireadh an t-úsáideoir ina thost');
  assert.match(irish.toast.like_failed, /‘Is maith liom’/u);
  assert.match(irish.realtime.new_posts_one, /tapáil lena fheiceáil/u);
  assert.match(irish.realtime.new_posts_other, /tapáil chun iad a fheiceáil/u);
  assert.equal(irish.compose.tab_listing, 'Liostú');
  assert.equal(irish.compose.listing_type_label, 'Cineál liostaithe');
  assert.match(irish.compose.listing_created, /Cruthaíodh an liostú/u);
  assert.equal(irish.compose.make_public, 'Cuir ar fáil go poiblí');
  assert.match(irish.compose.make_public_desc, /tacú léi/u);
  assert.equal(irish.compose.listing_preview_alt, 'Réamhamharc ar an liostú');
  assert.equal(irish.compose.group_members_one, '{{count}} bhall');
  assert.equal(irish.compose.group_members_many, '{{count}} mball');
});
