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
  assert.doesNotMatch(catalogue, /Sceideal postáil|Sceidealaithe do|Cum cineál ábhair|Cum post"/u);
  assert.doesNotMatch(catalogue, /ábhar an phost|Tá an post ró-fhada|curtha ar leataobh|ró-mhór/u);
  assert.doesNotMatch(catalogue, /Balbhaigh|Bhuaigh .*suaitheantas|Seol tuairim|Theip ar roinnt/u);
  assert.doesNotMatch(catalogue, /sonraí an vóta|an vóta seo críochnaithe|vóta iomlán/u);

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
  assert.equal(irish.compose.voice_unsupported, 'Ní thacaíonn an brabhsálaí seo le hionchur gutha');
  assert.equal(irish.compose.schedule_label, 'Postáil a sceidealú');
  assert.equal(irish.compose.schedule_button, 'Sceidealaigh');
  assert.equal(irish.compose.post_scheduled, 'Sceidealaíodh an phostáil!');
  assert.equal(irish.compose.type_tabs_aria, 'Cineál ábhair na postála');
  assert.equal(irish.compose.compose_post, 'Cum postáil');
  assert.match(irish.compose.template_post_achievement_content, /críochnaithe agam/u);
  assert.match(irish.compose.template_post_recommend_content, /an obair iontach atá déanta acu/u);
  assert.equal(irish.compose.media_rejected_many, 'Fágadh {{count}} gcomhad ar lár (cineál mícheart nó rómhór)');
  assert.equal(irish.compose.media_compression_failed_many, 'Níorbh fhéidir {{count}} n-íomhá a phróiseáil');
  assert.match(irish.compose.content_required, /ábhar na postála/u);
  assert.equal(irish.card.unlike, 'Bain ‘Is maith liom’');
  assert.equal(irish.card.mute_user, 'Cuir {{name}} ina thost');
  assert.match(irish.card.badge_earned_message, /^Thuill/u);
  assert.equal(irish.card.send_comment, 'Seol an trácht');
  assert.match(irish.card.share_failed, /an phostáil a roinnt/u);
  assert.equal(irish.card.event.starts_in_minutes, 'Tosóidh sé i gceann {{minutes}} nóiméad');
  assert.equal(irish.card.volunteer.credits_offered_many, '{{count}} gcreidmheas ama');
  assert.equal(irish.card.review.rating_aria, '{{rating}} réalta as 5');
  assert.equal(irish.poll.load_failed, 'Níorbh fhéidir sonraí na pobalbhreithe a lódáil.');
  assert.equal(irish.poll.live, 'Ar siúl');
  assert.match(irish.poll.results_hidden_until_close, /nuair a dhúnfar an phobalbhreith/u);
});

test('the complete Irish Feed catalogue retains only reviewed language-neutral values', async () => {
  const english = JSON.parse(await readFile(new URL('../public/locales/en/feed.json', import.meta.url)));
  const flatten = (value, prefix = '', output = {}) => {
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        flatten(child, prefix ? `${prefix}.${key}` : key, output);
      }
    } else {
      output[prefix] = String(value);
    }
    return output;
  };
  const gaValues = flatten(irish);
  const enValues = flatten(english);
  const exactMatches = Object.keys(gaValues)
    .filter((key) => gaValues[key] === enValues[key])
    .sort();

  assert.equal(Object.keys(gaValues).length, 636);
  assert.deepEqual(exactMatches, [
    'compose.char_count',
    'compose.placeholder_hours',
    'location.km',
    'location.radius',
  ]);

  const catalogue = JSON.stringify(irish);
  assert.doesNotMatch(catalogue, /Ag Treocht|Mód beatha|"Retry"|Úúú|Díbir/u);
  assert.doesNotMatch(catalogue, /Díbhalbhaigh|Tacaithe:|Rialuithe beatha|Poist nua ar fáil/u);
  assert.equal(irish.hashtag.post_count_many, '{{count}} bpostáil');
  assert.equal(irish.hashtags.title, 'Haischlibeanna i mbéal an phobail');
  assert.equal(irish.video.unmute, 'Cuir an fhuaim ar siúl');
  assert.equal(irish.stories.retry, 'Bain triail eile as');
  assert.equal(irish.reaction.wow, 'Iontas');
  assert.equal(irish.suggestions.dismiss, 'Folaigh');
  assert.equal(irish.suggestions.mutual_many, '{{count}} gceangal i gcoiteann');
  assert.equal(irish.analytics.shares, 'Comhroinntí');
  assert.equal(irish.controls_region_label, 'Rialuithe an fhotha');
});
