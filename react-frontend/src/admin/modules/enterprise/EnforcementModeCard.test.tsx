// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnforcementModeCard } from './EnforcementModeCard';

// Returns the key so assertions name the string being shown, not its English text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

/**
 * 🔴 This card is READ-ONLY by design. The enforcement mode can stop members
 * using the platform, so it stays a considered change to a server file rather
 * than a button one mis-click away. The first test below is the one that matters:
 * it fails if anyone ever adds a control here.
 */
describe('EnforcementModeCard', () => {
  it('offers no control of any kind', () => {
    const { container } = render(
      <EnforcementModeCard enforcement={{ mode: 'report', editable_here: false }} />
    );

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(container.querySelectorAll('form')).toHaveLength(0);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('renders nothing when the backend did not send the field', () => {
    // An older backend does not send it. Showing an empty card, or claiming a
    // mode we do not know, would both be worse than showing nothing.
    const { container } = render(<EnforcementModeCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the mode is missing', () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <EnforcementModeCard enforcement={{ mode: '' } as any} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('names each mode in words, not by colour alone', () => {
    for (const [mode, labelKey] of [
      ['off', 'enterprise.legal_enforcement_mode_off'],
      ['report', 'enterprise.legal_enforcement_mode_report'],
      ['write', 'enterprise.legal_enforcement_mode_write'],
      ['all', 'enterprise.legal_enforcement_mode_all'],
    ] as const) {
      const { unmount } = render(<EnforcementModeCard enforcement={{ mode }} />);
      expect(screen.getByText(labelKey)).toBeInTheDocument();
      unmount();
    }
  });

  it('explains what the active mode actually does', () => {
    render(<EnforcementModeCard enforcement={{ mode: 'report' }} />);

    expect(screen.getByText('enterprise.legal_enforcement_report_help')).toBeInTheDocument();
  });

  it('describes an unrecognised mode as enforced, matching the server', () => {
    // 🔴 Reversed on 2026-08-11 along with the default. The middleware treats an
    // unrecognised value as `write`, because with enforcement as the legal baseline
    // the dangerous typo is the one that switches it OFF. The two sides must never
    // disagree about what the platform is actually doing.
    render(<EnforcementModeCard enforcement={{ mode: 'enforce-everything' }} />);

    expect(screen.getByText('enterprise.legal_enforcement_mode_write')).toBeInTheDocument();
    expect(screen.getByText('enterprise.legal_enforcement_write_help')).toBeInTheDocument();
  });

  it('lists which documents are gated', () => {
    render(
      <EnforcementModeCard
        enforcement={{ mode: 'report', enforced_acceptance_modes: ['registration', 'login'] }}
      />
    );

    expect(screen.getByText('enterprise.legal_enforcement_gated_label')).toBeInTheDocument();
    expect(screen.getByText(/registration, login/)).toBeInTheDocument();
  });

  it('omits the gated list when the server sent none', () => {
    render(<EnforcementModeCard enforcement={{ mode: 'report', enforced_acceptance_modes: [] }} />);

    expect(screen.queryByText('enterprise.legal_enforcement_gated_label')).toBeNull();
  });

  it('says plainly that it cannot be changed here', () => {
    render(<EnforcementModeCard enforcement={{ mode: 'report', editable_here: false }} />);

    expect(
      screen.getByText('enterprise.legal_enforcement_read_only_notice')
    ).toBeInTheDocument();
  });
});
