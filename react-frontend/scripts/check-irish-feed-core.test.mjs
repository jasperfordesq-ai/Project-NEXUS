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
  assert.doesNotMatch(catalogue, /Cur síos AI ginte|creidmheasanna AI úsáidte|Dréacht athchóirithe/u);
  assert.doesNotMatch(catalogue, /Tarraing chun athordú|Liosta urchar|Ag luchtú réamhamhairc|10MB/u);

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
  assert.equal(irish.compose.ai_generated, 'Gineadh an cur síos le AI!');
  assert.match(irish.compose.ai_rate_limited, /go léir/u);
  assert.equal(irish.compose.draft_restored, 'Cuireadh an dréacht ar ais');
  assert.equal(irish.compose.images_reorder, 'Tarraing chun an t-ord a athrú');
  assert.equal(irish.compose.bullet_list, 'Liosta le hurchair');
  assert.equal(irish.compose.link_preview_loading, 'Réamhamharc á lódáil...');
});
