// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
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
  selectedJurisdiction: 'england_wales',
  onJurisdictionChange: vi.fn(),
  savingPolicy: false,
  onSavePolicy: vi.fn(),
};

describe('VettingPolicyCard', () => {
  it('states the jurisdiction, required confirmation and purpose', () => {
    render(<VettingPolicyCard {...baseProps} />);
    expect(screen.getByText('Safeguarding contact policy')).toBeInTheDocument();
    // The label appears in the summary and again as the selected jurisdiction.
    expect(screen.getAllByText('England and Wales').length).toBeGreaterThan(0);
    expect(screen.getByText('Enhanced DBS')).toBeInTheDocument();
    expect(screen.getByText('Safeguarded member contact')).toBeInTheDocument();
    expect(screen.getByText('Do not upload vetting documents')).toBeInTheDocument();
  });

  it('lets an admin pick a jurisdiction, with Save disabled until it changes', async () => {
    const onSavePolicy = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<VettingPolicyCard {...baseProps} onSavePolicy={onSavePolicy} />);

    expect(screen.queryByText('Admin only')).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save jurisdiction' });
    expect(save).toBeDisabled();

    rerender(<VettingPolicyCard {...baseProps} onSavePolicy={onSavePolicy} selectedJurisdiction="scotland" />);
    expect(save).not.toBeDisabled();
    await user.click(save);
    expect(onSavePolicy).toHaveBeenCalledTimes(1);
  });

  it('shows a broker the jurisdiction read-only and marked Admin only', () => {
    render(<VettingPolicyCard {...baseProps} canConfigurePolicy={false} />);
    expect(screen.getByText('Admin only')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Safeguarding jurisdiction' })).toHaveTextContent('England and Wales');
    expect(screen.queryByRole('button', { name: 'Save jurisdiction' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an admin can change the safeguarding jurisdiction/)).toBeInTheDocument();
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
