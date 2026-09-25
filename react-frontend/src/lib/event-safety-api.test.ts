// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi } from 'vitest';
import {
  eventSafetyReviewsSchema,
  eventSafetySchema,
  parseEventSafetyResponse,
} from './event-safety-api';

const safety = {
  contract_version: 1,
  event_id: 101,
  rollout: {
    mode: 'shadow',
    source: 'tenant_override',
    configuration_valid: true,
    enforcement_active: false,
  },
  requirements: {
    status: 'published',
    revision: 3,
    current_version: 2,
    published_version: 2,
    version: {
      number: 2,
      minimum_age: 14,
      guardian_consent_required: false,
      minor_age_threshold: null,
      code_of_conduct: {
        required: true,
        text: 'Respect everyone.',
        text_version: 'conduct-v2',
        text_hash: 'a'.repeat(64),
      },
      published_at: '2030-04-01T09:00:00+00:00',
    },
  },
  eligibility: {
    status: 'deny',
    reason_codes: ['event_safety_code_of_conduct_acknowledgement_required'],
    required_actions: ['event_safety_acknowledge_code_of_conduct'],
    requirements_version: 2,
    age_at_event: 20,
    minor_at_event: false,
  },
  evidence: {
    code_of_conduct: {
      status: 'required',
      acknowledgement_id: null,
      text_version: 'conduct-v2',
      acknowledged_at: null,
    },
    guardian_consent: {
      status: 'not_required',
      consent_id: null,
      consent_version: null,
      expires_at: null,
      granted_at: null,
    },
    active_denial: null,
  },
  permissions: {
    manage_requirements: false,
    review_participation: false,
    acknowledge_code_of_conduct: true,
    withdraw_code_of_conduct: false,
    request_guardian_consent: false,
    withdraw_guardian_consent: false,
  },
  privacy: {
    guardian_identity_redacted: true,
    guardian_token_redacted: true,
    safeguarding_policy_evidence_redacted: true,
    free_text_review_notes_supported: false,
  },
} as const;

describe('Event Safety API contract', () => {
  it('accepts the strict privacy-minimised safety projection', () => {
    expect(eventSafetySchema.safeParse(safety).success).toBe(true);
  });

  it('accepts a projection with the retired guardian-consent fields left out', () => {
    const { guardian_consent_required: _required, minor_age_threshold: _threshold, ...version } = safety.requirements.version;
    const { guardian_consent: _evidence, ...evidence } = safety.evidence;
    const {
      request_guardian_consent: _request,
      withdraw_guardian_consent: _withdraw,
      ...permissions
    } = safety.permissions;
    const {
      guardian_identity_redacted: _identity,
      guardian_token_redacted: _token,
      ...privacy
    } = safety.privacy;

    expect(eventSafetySchema.safeParse({
      ...safety,
      requirements: { ...safety.requirements, version },
      evidence,
      permissions,
      privacy,
    }).success).toBe(true);
  });

  it('rejects accidental secret-bearing response fields', () => {
    expect(eventSafetySchema.safeParse({
      ...safety,
      guardian_token: 'must-never-reach-a-client',
    }).success).toBe(false);
    expect(eventSafetySchema.safeParse({
      ...safety,
      eligibility: {
        ...safety.eligibility,
        safeguarding_policy: { code: 'private' },
      },
    }).success).toBe(false);
  });

  it('fails closed on contract drift without retaining response data', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = parseEventSafetyResponse('/v2/events/101/safety', {
      success: true,
      data: { ...safety, contract_version: 2 },
    }, eventSafetySchema);

    expect(response.success).toBe(false);
    expect(response.code).toBe('EVENT_SAFETY_CONTRACT_DRIFT');
    expect(response.data).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[Error] Event Safety contract drift',
      expect.objectContaining({ endpoint: '/v2/events/101/safety', version: 1 }),
    );
    errorSpy.mockRestore();
  });

  it('validates controlled review history without notes or contact data', () => {
    const ledger = {
      items: [{
        denial: {
          id: 10,
          decision: 'deny',
          reason_code: 'safety_review',
          status: 'active',
          decision_version: 2,
          effective_from: '2030-05-01T09:00:00+00:00',
          effective_until: null,
          reviewed_at: '2030-04-01T09:00:00+00:00',
        },
        member: { id: 8, display_name: 'Alex Morgan', avatar_url: null },
        reviewer: { id: 7, display_name: 'Event manager' },
        history: [{
          decision_version: 2,
          decision: 'deny',
          reason_code: 'safety_review',
          status: 'active',
          action: 'recorded',
          effective_from: '2030-05-01T09:00:00+00:00',
          effective_until: null,
          reviewed_at: '2030-04-01T09:00:00+00:00',
          reviewer: { id: 7, display_name: 'Event manager' },
        }],
      }],
      total: 1,
      page: 1,
      per_page: 25,
    };

    expect(eventSafetyReviewsSchema.safeParse(ledger).success).toBe(true);
    expect(eventSafetyReviewsSchema.safeParse({
      ...ledger,
      items: [{ ...ledger.items[0], email: 'private@example.test' }],
    }).success).toBe(false);
  });
});
