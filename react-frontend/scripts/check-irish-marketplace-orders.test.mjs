// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/marketplace.json', import.meta.url)));

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
