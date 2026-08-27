// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';

import { translationToken, GDPR_AUDIT_UNKNOWN_TOKEN } from './gdprAuditTranslations';

describe('translationToken', () => {
  it('normalises a plain value to its translation-key suffix', () => {
    expect(translationToken('user')).toBe('user');
    expect(translationToken('User')).toBe('user');
    expect(translationToken('GDPR Request')).toBe('gdpr_request');
    expect(translationToken('consent-type')).toBe('consent_type');
  });

  it('trims separators from both ends', () => {
    expect(translationToken('  spaced  ')).toBe('spaced');
    expect(translationToken('__user__')).toBe('user');
  });

  // The reported crash: gdpr_audit_log.entity_type is null for a deleted
  // account, and the previous implementation called .toLowerCase() on it.
  it('falls back to the unknown token instead of throwing on a missing value', () => {
    expect(translationToken(null)).toBe(GDPR_AUDIT_UNKNOWN_TOKEN);
    expect(translationToken(undefined)).toBe(GDPR_AUDIT_UNKNOWN_TOKEN);
    expect(translationToken('')).toBe(GDPR_AUDIT_UNKNOWN_TOKEN);
  });

  it('falls back to the unknown token when nothing survives normalisation', () => {
    // An all-punctuation value would otherwise build the bare key
    // `enterprise.gdpr_entity_type_`, which matches no translation.
    expect(translationToken('***')).toBe(GDPR_AUDIT_UNKNOWN_TOKEN);
    expect(translationToken('   ')).toBe(GDPR_AUDIT_UNKNOWN_TOKEN);
  });

  it('resolves to the existing unknown translation keys', () => {
    expect(`enterprise.gdpr_entity_type_${translationToken(null)}`).toBe('enterprise.gdpr_entity_type_unknown');
    expect(`enterprise.gdpr_audit_action_${translationToken(null)}`).toBe('enterprise.gdpr_audit_action_unknown');
  });
});
