// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/marketplace.json', import.meta.url)));
const english = JSON.parse(await readFile(new URL('../public/locales/en/marketplace.json', import.meta.url)));

function flattenStrings(value, prefix = '', output = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, prefix ? `${prefix}.${key}` : key, output);
    }
  } else if (typeof value === 'string') {
    output[prefix] = value;
  }

  return output;
}

test('Irish Marketplace checkout, shipping and order wording preserves buyer and seller actions', () => {
  const journey = JSON.stringify({
    checkout: irish.checkout,
    shipping: irish.shipping,
    orders: irish.orders,
  });

  assert.doesNotMatch(journey, /Seiceáil Slán|"discount":"Discount"|"shipping":"Postáil"/u);
  assert.doesNotMatch(journey, /tseiceáil amach|Ainm an Teachtaire|0\. 00|Bailiúchán Áitiúil/u);
  assert.doesNotMatch(journey, /Cruthaigh Liosta|Rátáil an Ceannaitheoir|hUathchríochnú/u);
  assert.doesNotMatch(journey, /Luasphost \/ Teachtaire|Ní féidir é seo a chealú/u);

  assert.equal(irish.checkout.title, 'Íocaíocht shlán');
  assert.equal(irish.checkout.shipping, 'Seachadadh');
  assert.equal(irish.checkout.discount, 'Lascaine');
  assert.equal(irish.shipping.courier_name, 'Ainm an chúiréara');
  assert.equal(irish.shipping.price_placeholder, '0.00');
  assert.equal(irish.shipping.local_pickup, 'Bailiú áitiúil');
  assert.equal(irish.orders.buyer.title, 'M’orduithe');
  assert.match(irish.orders.buyer.confirm_delivery_modal_body, /Ní féidir dul siar air seo/u);
  assert.equal(irish.orders.seller.create_listing, 'Cruthaigh liostú');
  assert.equal(irish.orders.seller.buyer_rated, 'Rátáil tugtha ag an gceannaitheoir');
  assert.equal(irish.orders.seller.shipping_method_express, 'Luasphost / Cúiréir');
  assert.equal(irish.orders.rating.submit, 'Seol an rátáil');
});

test('Irish Marketplace listing and offer wording preserves listing and negotiation meaning', () => {
  const journey = JSON.stringify({
    listing: irish.listing,
    offer: irish.offer,
  });

  assert.doesNotMatch(journey, /Liosta Gan Aimsiú|Inchaibidle|Cleiteach|Féach ar an nGach/u);
  assert.doesNotMatch(journey, /Físeán liosta|gclib físe|Tuairiscigh an Liostáil|Bain ó shábháilte/u);
  assert.doesNotMatch(journey, /0\. 00|Frithsheasta|Frith: \{\{amount\}\}|Tairiscint íoctha/u);

  assert.equal(irish.listing.not_found_title, 'Níor aimsíodh an liostú');
  assert.equal(irish.listing.negotiable, 'Soshannta');
  assert.equal(irish.listing.featured, 'Roghnaithe');
  assert.equal(irish.listing.listings_count, '{{count}} liostú');
  assert.equal(irish.listing.view_all, 'Féach orthu uile');
  assert.equal(irish.listing.video_unsupported, 'Ní thacaíonn do bhrabhsálaí leis an bhfíseán seo.');
  assert.equal(irish.listing.report_submitted, 'Cuireadh an tuairisc isteach. Go raibh maith agat.');
  assert.equal(irish.listing.save, 'Sábháil an liostú');
  assert.equal(irish.listing.unsave, 'Bain de na míreanna sábháilte é');
  assert.equal(irish.offer.amount_placeholder, '0.00');
  assert.equal(irish.offer.status.countered, 'Friththairiscint déanta');
  assert.equal(irish.offer.counter, 'Déan friththairiscint');
  assert.equal(irish.offer.pay_accepted, 'Íoc as an tairiscint ar glacadh léi');
});

test('Irish Marketplace creation and discovery wording preserves commerce and filter meaning', () => {
  const journey = JSON.stringify({
    breadcrumb: irish.breadcrumb,
    metaDescription: irish.meta_description,
    hub: irish.hub,
    featureGate: irish.hub_feature_gate,
    create: irish.create,
    search: irish.search,
    category: irish.category,
    common: irish.common,
    condition: irish.condition,
    priceType: irish.price_type,
    deliveryMethod: irish.delivery_method,
    sort: irish.sort,
    timeAgo: irish.time_ago,
    filters: irish.filters,
    gallery: irish.gallery,
    price: irish.price,
    empty: irish.empty,
  });

  assert.doesNotMatch(journey, /\bBreadcrumb\b|Liostaí Cleiteacha|Sainráite|Inchaibidle/u);
  assert.doesNotMatch(journey, /\bliosta(?:í)?\b|Loingseoireacht|Dífhostaigh|Lódáil/u);
  assert.doesNotMatch(journey, /Postáilte Laistigh de|Na \d+ Lá Seo Caite|Tosaigh ag Díol/u);
  assert.doesNotMatch(journey, /\{\{count\}\}(?:n|u|l) ó shin/u);

  assert.equal(irish.breadcrumb, 'Conair nascleanúna');
  assert.equal(irish.hub.featured_listings, 'Liostuithe roghnaithe');
  assert.equal(irish.create.subtitle, 'Cruthaigh liostú nua sa mhargadh');
  assert.equal(irish.create.publish, 'Foilsigh an liostú');
  assert.equal(irish.create.description_generate_failed, 'Níorbh fhéidir an cur síos a ghiniúint');
  assert.equal(irish.search.delivery_shipping, 'Seoladh amháin');
  assert.equal(irish.search.last_30_days, 'Le 30 lá anuas');
  assert.equal(irish.category.listings_count_few, '{{count}} liostú');
  assert.equal(irish.common.dismiss, 'Dún');
  assert.equal(irish.price_type.negotiable, 'Soshannta');
  assert.equal(irish.delivery_method.pickup, 'Bailiú amháin');
  assert.equal(irish.time_ago.hours_ago, '{{count}} uair ó shin');
  assert.equal(irish.filters.apply, 'Cuir na scagairí i bhfeidhm');
});

test('Irish Marketplace seller and owner wording preserves listing and offer ownership', () => {
  const journey = JSON.stringify({
    seller: irish.seller,
    edit: irish.edit,
    myListings: irish.my_listings,
    myOffers: irish.my_offers,
  });

  assert.doesNotMatch(journey, /\bliosta(?:í)?\b|Athnuadh an liosta|Frith-thairiscint/u);
  assert.doesNotMatch(journey, /seiceáil amach|Lean tairiscintí|Ní féidir an gníomh seo a chealú/u);
  assert.doesNotMatch(journey, /Mo Liostaí|Gan Liostaí|Liostaí Gníomhacha/u);

  assert.equal(irish.seller.active_listings, 'Liostuithe gníomhacha');
  assert.equal(irish.seller.view_profile, 'Féach ar an bpróifíl');
  assert.equal(irish.edit.not_owner, 'Ní féidir leat ach na liostuithe atá agat féin a chur in eagar');
  assert.equal(irish.edit.updated_success, 'Nuashonraíodh an liostú!');
  assert.equal(irish.my_listings.renewed_success, 'Athnuaíodh an liostú');
  assert.equal(irish.my_listings.remove_confirm_description, 'An bhfuil tú cinnte gur mhaith leat an liostú seo a bhaint? Ní féidir dul siar air seo.');
  assert.equal(irish.my_offers.subtitle, 'Coinnigh súil ar na tairiscintí a sheol tú agus a fuair tú');
  assert.equal(irish.my_offers.counter_amount_label, 'Suim na friththairisceana');
  assert.equal(irish.my_offers.send_counter, 'Seol an fhriththairiscint');
  assert.equal(irish.my_offers.checkout_started_success, 'Cuireadh tús leis an íocaíocht ar an tairiscint ar glacadh léi.');
});

test('Irish Marketplace collections, saved searches and promotions preserve their member actions', () => {
  const journey = JSON.stringify({
    collections: irish.collections,
    savedSearches: irish.saved_searches,
    promotions: irish.promotions,
  });

  assert.doesNotMatch(journey, /Liosta Cleiteach|Carbhsheó|Scoránaigh gníomhach/u);
  assert.doesNotMatch(journey, /\bliosta(?:í)?\b|Gan Earraí Fós|Gan Bailiúcháin Fós/u);
  assert.doesNotMatch(journey, /Cur Chun Cinn an Liosta|Theip ar chruthú an chur chun cinn/u);

  assert.equal(irish.collections.subtitle, 'Eagraigh na hearraí is ansa leat sa mhargadh agus coinnigh súil orthu');
  assert.equal(irish.collections.empty_description, 'Cuir earraí ó liostuithe sa mhargadh leis an mbailiúchán seo.');
  assert.equal(irish.collections.sign_in_title, 'Ní mór síniú isteach');
  assert.equal(irish.saved_searches.empty_description, 'Sábháil cuardach ón margadh chun foláirimh a fháil nuair a chuirtear earraí nua a oireann dó ar an margadh.');
  assert.equal(irish.saved_searches.toggle_active, 'Cuir ar siúl nó as');
  assert.equal(irish.promotions.title, 'Cuir an liostú chun cinn');
  assert.equal(irish.promotions.featured, 'Liostú roghnaithe');
  assert.equal(irish.promotions.homepage_carousel, 'Timpeallán an leathanaigh baile');
});

test('Irish Marketplace delivery, pickup and inventory wording preserves fulfilment meaning', () => {
  const journey = JSON.stringify({
    communityDelivery: irish.community_delivery,
    pickup: irish.pickup,
    inventory: irish.inventory,
  });

  assert.doesNotMatch(journey, /ceannaitheoir\/díoltóir|Tairg Seachadadh|Mo bhailiúcháin/u);
  assert.doesNotMatch(journey, /Fuinneog bhailithe|sliotán bailiúcháin|Lean stoc agus cosc/u);
  assert.doesNotMatch(journey, /Stoc: \{\{count\}\} \(Íseal\)|~\{\{count\}\} nóim(?!\.)/u);

  assert.match(irish.community_delivery.tooltip, /mar mhalairt ar chreidmheasanna ama/u);
  assert.equal(irish.community_delivery.offer_to_deliver, 'Tairg an t-earra a sheachadadh');
  assert.equal(irish.community_delivery.offer_modal_description, 'Tairg an t-earra seo a sheachadadh agus creidmheasanna ama a thuilleamh. Déanfaidh an ceannaitheoir nó an díoltóir athbhreithniú ar do thairiscint.');
  assert.equal(irish.pickup.my_pickups_title, 'Na hearraí atá le bailiú agam');
  assert.equal(irish.pickup.choose_slot, 'Roghnaigh tréimhse bhailithe');
  assert.equal(irish.pickup.reservation_failed, 'Níorbh fhéidir an tréimhse bhailithe sin a chur in áirithe. Roghnaigh tréimhse eile.');
  assert.equal(irish.inventory.section_subtitle, 'Coinnigh súil ar an stoc agus seachain níos mó earraí a dhíol ná mar atá ar fáil.');
  assert.equal(irish.inventory.low_chip, 'Stoc: {{count}} (beagán fágtha)');
});

test('Irish Marketplace free items, maps, AI replies and seller setup preserve their intended journeys', () => {
  const journey = JSON.stringify({
    free: irish.free,
    groupMarketplace: irish.group_marketplace,
    hybridPricing: irish.hybrid_pricing,
    aiReply: irish.ai_reply,
    map: irish.map,
    listingLocation: irish.listing_location,
    onboarding: irish.onboarding,
  });

  assert.doesNotMatch(journey, /Tabhair Rud Éigin Uait|Gan Earraí Saor in Aisce/u);
  assert.doesNotMatch(journey, /\bliosta(?:í)?\b|Freagra Molta ag AI|Cóipeáilte/u);
  assert.doesNotMatch(journey, /Ionduchtú|do thús ceannaí|Suíomh neastachta/u);

  assert.equal(irish.free.cta_title, 'Glan amach an tranglam agus cabhraigh le do phobal');
  assert.equal(irish.group_marketplace.active_listings, 'liostuithe gníomhacha');
  assert.match(irish.hybrid_pricing.explanation, /obair ar son an phobail/u);
  assert.equal(irish.ai_reply.suggested_reply, 'Freagra a mhol IS');
  assert.equal(irish.map.results_count, 'Aimsíodh {{count}} liostú in aice láimhe');
  assert.equal(irish.map.distance_meters, '{{m}} m ar shiúl');
  assert.equal(irish.listing_location.approximate_location, 'Suíomh garbh');
  assert.equal(irish.onboarding.nudge_title, 'Críochnaigh socrú do chuntais díoltóra');
  assert.equal(irish.onboarding.start_error, 'Níorbh fhéidir tús a chur leis an socrú');
});

test('complete Irish Marketplace catalogue keeps only reviewed language-neutral values', () => {
  const englishStrings = flattenStrings(english);
  const irishStrings = flattenStrings(irish);
  const exactKeys = Object.keys(englishStrings)
    .filter((key) => irishStrings[key] === englishStrings[key])
    .sort();

  assert.deepEqual(exactKeys, [
    'community_delivery.estimated_time_placeholder',
    'community_delivery.time_credits_placeholder',
    'create.photos_count',
    'listing.detail_field_label',
    'map.radius_option',
    'offer.amount_placeholder',
    'shipping.price_placeholder',
  ]);

  const catalogue = JSON.stringify(irish);
  assert.doesNotMatch(catalogue, /Inchaibidle|Cleiteach|Carbhsheó|Frithsheasta/u);
  assert.doesNotMatch(catalogue, /seiceáil amach|Dífhostaigh|Loingseoireacht/u);
  assert.doesNotMatch(catalogue, /\uFFFD|â€|Ã.|\?s\?|\s{2,}/u);
});
