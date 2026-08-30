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

function requirePopulatedCollection(body, label) {
  const envelope = requireFields(body, ['data', 'meta'], `${label} response`);
  if (!Array.isArray(envelope.data) || envelope.data.length === 0) {
    throw new Error(`${label} response must contain the deterministic fixture item`);
  }
  return envelope.data[0];
}

function validateCanonicalEvents(body) {
  requireFields(
    requirePopulatedCollection(body, 'events'),
    ['id', 'title', 'description', 'organizer', 'location', 'schedule', 'relationship', 'permissions', 'metrics'],
    'event item',
  );
}

function validateMarketplaceSearch(body) {
  requireFields(
    requirePopulatedCollection(body, 'marketplace'),
    ['id', 'title', 'price', 'price_currency', 'price_type', 'delivery_method', 'status', 'image', 'image_count', 'is_saved', 'is_own', 'is_promoted', 'views_count', 'created_at'],
    'marketplace item',
  );
}

function validateVolunteeringSearch(body) {
  requireFields(
    requirePopulatedCollection(body, 'volunteering'),
    ['id', 'title', 'description', 'organization', 'location', 'is_remote', 'skills_needed', 'status', 'created_at'],
    'volunteering item',
  );
}

function validateMatchesPayload(body) {
  const envelope = requireFields(body, ['data'], 'matches response');
  const payload = requireFields(envelope.data, ['matches', 'meta'], 'matches payload');
  if (!Array.isArray(payload.matches)) throw new Error('matches payload matches must be an array');
  requireFields(
    payload.meta,
    ['needs_location', 'degraded', 'degraded_reason', 'has_active_listings', 'paused'],
    'matches meta',
  );
}

function validateOwnedOrganisation(body) {
  requireFields(
    requirePopulatedCollection(body, 'owned organisation'),
    ['id', 'name'],
    'owned organisation item',
  );
}

function validateOrganisationStats(body) {
  const envelope = requireFields(body, ['data'], 'organisation stats response');
  requireFields(
    envelope.data,
    ['total_volunteers', 'pending_applications', 'pending_hours', 'total_approved_hours', 'active_opportunities', 'wallet_balance', 'auto_pay_enabled', 'org_name'],
    'organisation stats',
  );
}

function validateOrganisationCollection(body, label) {
  const envelope = requireFields(body, ['data'], `${label} response`);
  if (Array.isArray(envelope.data)) return;
  const collection = requireFields(envelope.data, ['items', 'cursor', 'has_more'], label);
  if (!Array.isArray(collection.items)) throw new Error(`${label} items must be an array`);
}

module.exports = {
  requireFields,
  validateCanonicalEvents,
  validateConnectionStatus,
  validateListingSearch,
  validateMarketplaceSearch,
  validateMatchesPayload,
  validateMemberSearch,
  validateOrganisationCollection,
  validateOrganisationStats,
  validateOwnedOrganisation,
  validateVolunteeringSearch,
};
