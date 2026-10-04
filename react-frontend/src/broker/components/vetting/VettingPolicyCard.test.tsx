// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { VettingPolicyResponse } from '@/admin/api/types';

vi.mock('@/contexts', () => createMockContexts());

import { VettingPolicyCard } from './VettingPolicyCard';

const policy: VettingPolicyResponse['policy'] = {
  configured: true,
  contact_policy_available: true,
  jurisdiction: 'england_wales',
  scheme_code: 'dbs_england_wales',
  attestation_code: 'dbs_enhanced',
  purpose_code: 'safeguarded_member_contact',
  scope_type: 'tenant',
  scope_identifier: '2',
  policy_version: 'safeguarded-contact-v1',
  label: 'England and Wales',
  attestation_label: 'Enhanced DBS',
  preset: 'england_wales',
  certification_options: [{ code: 'dbs_enhanced', label: 'Enhanced DBS' }],
} as VettingPolicyResponse['policy'];

const policyData = {
  policy,
  jurisdictions: [
    { code: 'england_wales', label: 'England and Wales', attestation_code: 'dbs_enhanced', attestation_label: 'Enhanced DBS', available_for_contact_policy: true, contact_policy_available: true, certification_options: [] },
    { code: 'scotland', label: 'Scotland', attestation_code: 'pvg_scotland', attestation_label: 'PVG', available_for_contact_policy: true, contact_policy_available: true, certification_options: [] },
  ],
  revocation_reason_codes: ['community_decision_withdrawn'],
  review_resolution_codes: ['no_change'],
} as unknown as VettingPolicyResponse;

const baseProps = {
  policyLoading: false,
  policyError: false,
  policy,
  policyData,
  isCoordinator: false,
  canRecordDecision: true,
  canConfigurePolicy: true,
};

// The jurisdiction is chosen on the Configuration page (Oct 2026); this card
// only states the policy and, for an admin, points there.
const CONFIGURATION_LINK = '/test/broker/configuration#config-section-compliance_safeguarding';

describe('VettingPolicyCard', () => {
  it('states the jurisdiction, required confirmation and purpose', () => {
    render(<VettingPolicyCard {...baseProps} />);
    expect(screen.getByText('Safeguarding contact policy')).toBeInTheDocument();
    expect(screen.getByText('England and Wales')).toBeInTheDocument();
    expect(screen.getByText('Enhanced DBS')).toBeInTheDocument();
    expect(screen.getByText('Safeguarded member contact')).toBeInTheDocument();
    expect(screen.getByText('Do not upload vetting documents')).toBeInTheDocument();
  });

  it('gives an admin a link to change the jurisdiction on the Configuration page, and no control here', () => {
    render(<VettingPolicyCard {...baseProps} />);
    expect(screen.getByRole('link', { name: 'Change the jurisdiction in Configuration' })).toHaveAttribute('href', CONFIGURATION_LINK);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save jurisdiction' })).not.toBeInTheDocument();
    expect(screen.queryByText('Admin only')).not.toBeInTheDocument();
  });

  it('shows a broker the policy with no link and no Admin only mark', () => {
    render(<VettingPolicyCard {...baseProps} canConfigurePolicy={false} />);
    expect(screen.getByText('England and Wales')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Change the jurisdiction in Configuration' })).not.toBeInTheDocument();
    expect(screen.queryByText('Admin only')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('tells a coordinator the page is view-only for them', () => {
    render(<VettingPolicyCard {...baseProps} isCoordinator />);
    expect(screen.getByText(/As a coordinator you can see vetting records here/)).toBeInTheDocument();
  });

  it('warns when the jurisdiction is set but has no usable contact policy', () => {
    render(<VettingPolicyCard {...baseProps} canRecordDecision={false} />);
    expect(screen.getByText(/does not yet have a supported contact-vetting policy/)).toBeInTheDocument();
  });

  it('says so when the policy could not be loaded', () => {
    render(<VettingPolicyCard {...baseProps} policy={null} policyData={null} policyError />);
    expect(screen.getByText(/The safeguarding policy could not be loaded/)).toBeInTheDocument();
  });
});
