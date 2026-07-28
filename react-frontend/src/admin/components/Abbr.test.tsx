// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

// The test environment loads no i18n resources, so the real t() returned an EMPTY
// string for admin_glossary keys here while CI fell back to returning the key —
// this suite's result therefore depended on which machine ran it. Pinning t() to
// the identity function makes the title assertion below mean the same thing
// everywhere. It asserts the component looks the definition up under the right
// key, which is the part that is this component's job; whether the German
// translation of terms.sla is correct is not this test's business.
// Partial, per this repo's convention: something in the tree imports
// initReactI18next, and a wholesale replacement drops it.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Abbr, ABBR_TERMS } from './Abbr';

/** <abbr> has no implicit ARIA role — query by tag name. */
function getAbbrEl() {
  return document.querySelector('abbr');
}

describe('Abbr', () => {
  it('renders an <abbr> element for a known term', () => {
    render(<Abbr term="CHF" />);
    expect(getAbbrEl()).not.toBeNull();
  });

  it('uses the term key as default children', () => {
    render(<Abbr term="GDPR" />);
    expect(screen.getByText('GDPR')).toBeInTheDocument();
  });

  it('renders custom children when provided', () => {
    render(<Abbr term="CHF">CHF 35/hr</Abbr>);
    expect(screen.getByText('CHF 35/hr')).toBeInTheDocument();
  });

  it('sets title attribute to the definition', () => {
    render(<Abbr term="SLA" />);
    const abbr = getAbbrEl();
    expect(abbr).toHaveAttribute('title', ABBR_TERMS.SLA);
  });

  it('applies extra className to the abbr element', () => {
    render(<Abbr term="XP" className="my-custom-class" />);
    const abbr = getAbbrEl();
    expect(abbr?.className).toContain('my-custom-class');
  });

  it('renders just the children (no abbr) for an unknown term', () => {
    // @ts-expect-error intentionally passing unknown term
    render(<Abbr term="UNKNOWN_TERM">fallback</Abbr>);
    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(getAbbrEl()).toBeNull();
  });

  it('renders the term key as text when no children and term is unknown', () => {
    // @ts-expect-error intentionally passing unknown term
    render(<Abbr term="NOSUCHKEY" />);
    expect(screen.getByText('NOSUCHKEY')).toBeInTheDocument();
  });

  it('ABBR_TERMS contains expected keys', () => {
    expect(ABBR_TERMS).toHaveProperty('GDPR');
    expect(ABBR_TERMS).toHaveProperty('NEXUS');
    expect(ABBR_TERMS).toHaveProperty('XP');
    expect(typeof ABBR_TERMS.GDPR).toBe('string');
  });
});
