// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireFields(value, fields, label) {
  const object = requireObject(value, label);
  const missing = fields.filter((field) => !Object.hasOwn(object, field));
  if (missing.length > 0) throw new Error(`${label} is missing ${missing.join(', ')}`);
  return object;
}

function validateListingSearch(body) {
  const envelope = requireFields(body, ['data', 'meta'], 'listing response');
  if (!Array.isArray(envelope.data) || envelope.data.length === 0) {
    throw new Error('listing response must contain the deterministic fixture item');
  }
  requireFields(
    envelope.data[0],
    ['id', 'title', 'description', 'type', 'status', 'hours_estimate', 'created_at', 'is_favorited'],
    'listing item',
  );
}

function validateMemberSearch(body) {
  const envelope = requireFields(body, ['data', 'meta'], 'member response');
  if (!Array.isArray(envelope.data) || envelope.data.length === 0) {
    throw new Error('member response must contain the deterministic fixture member');
  }
  requireFields(
    envelope.data[0],
    ['id', 'name', 'first_name', 'tagline', 'location', 'created_at', 'rating', 'total_hours_given', 'total_hours_received'],
    'member item',
  );
}

function validateConnectionStatus(body) {
  const envelope = requireFields(body, ['data'], 'connection response');
  requireFields(envelope.data, ['status', 'connection_id', 'direction'], 'connection status');
}

module.exports = { requireFields, validateConnectionStatus, validateListingSearch, validateMemberSearch };
