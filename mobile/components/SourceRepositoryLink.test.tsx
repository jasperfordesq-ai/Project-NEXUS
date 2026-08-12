// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AGPL-3.0-or-later Section 7(b) compliance guard.
 *
 * These assertions exist so the attribution notice and the source-repository
 * link cannot silently disappear from the mobile app. Mirrors
 * `react-frontend/src/components/layout/SourceRepositoryLink.test.tsx`.
 * If one of these fails, fix the component — do not relax the test.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import SourceRepositoryLink, { PROJECT_NEXUS_REPO_URL } from './SourceRepositoryLink';
import enCommon from '../locales/en/common.json';
import gaCommon from '../locales/ga/common.json';
import deCommon from '../locales/de/common.json';
import frCommon from '../locales/fr/common.json';
import itCommon from '../locales/it/common.json';
import esCommon from '../locales/es/common.json';
import ptCommon from '../locales/pt/common.json';

describe('SourceRepositoryLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports the canonical repo URL constant', () => {
    expect(PROJECT_NEXUS_REPO_URL).toBe('https://github.com/jasperfordesq-ai/Project-NEXUS');
  });

  it('renders the AGPL licence notice', () => {
    const { getByText } = render(<SourceRepositoryLink />);
    expect(getByText(/AGPL-3\.0-or-later/)).toBeTruthy();
  });

  it('renders the copyright notice with the current year', () => {
    const { getByText } = render(<SourceRepositoryLink />);
    const year = new Date().getFullYear();
    expect(getByText(`Copyright © 2024–${year} Jasper Ford`)).toBeTruthy();
  });

  it('renders the "Built on Project NEXUS by Jasper Ford" attribution wording', () => {
    const { getByText } = render(<SourceRepositoryLink />);
    expect(getByText('Built on Project NEXUS by Jasper Ford')).toBeTruthy();
  });

  it('renders a tappable source-repository link', () => {
    const { getByTestId } = render(<SourceRepositoryLink />);
    expect(getByTestId('source-repository-link')).toBeTruthy();
  });

  it('opens the canonical repository URL when pressed', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    const { getByTestId } = render(<SourceRepositoryLink />);
    fireEvent.press(getByTestId('source-repository-link'));

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://github.com/jasperfordesq-ai/Project-NEXUS');
  });

  it('exposes the link to screen readers with a non-empty accessibility label', () => {
    const { getByTestId } = render(<SourceRepositoryLink />);
    const link = getByTestId('source-repository-link');

    expect(link.props.accessibilityLabel).toBeTruthy();
    expect(link.props.accessibilityLabel).not.toBe('');
    expect(link.props.accessibilityLabel).not.toBe('sourceRepo.accessibilityLabel');
  });

  it('forwards a spacing className override to the container', () => {
    const { getByTestId } = render(<SourceRepositoryLink className="mt-6" />);
    expect(getByTestId('source-repository-attribution').props.className).toContain('mt-6');
  });

  describe('translation coverage', () => {
    const locales = {
      en: enCommon,
      ga: gaCommon,
      de: deCommon,
      fr: frCommon,
      it: itCommon,
      es: esCommon,
      pt: ptCommon,
    } as Record<
      string,
      {
        attribution?: string;
        sourceRepo?: { copyright?: string; builtOn?: string; accessibilityLabel?: string };
      }
    >;

    it.each(Object.keys(locales))(
      'defines the attribution and source-repo keys in %s',
      (locale) => {
        const bundle = locales[locale];
        expect(bundle.attribution).toBeTruthy();
        expect(bundle.sourceRepo?.copyright).toBeTruthy();
        expect(bundle.sourceRepo?.builtOn).toBeTruthy();
        expect(bundle.sourceRepo?.accessibilityLabel).toBeTruthy();
        // The year must stay interpolated, never baked into the translation.
        expect(bundle.sourceRepo?.copyright).toContain('{{year}}');
      },
    );

    it.each(Object.keys(locales))(
      'keeps the untranslatable "Project NEXUS" attribution name in %s',
      (locale) => {
        expect(locales[locale].sourceRepo?.builtOn).toContain('Project NEXUS');
        expect(locales[locale].sourceRepo?.builtOn).toContain('Jasper Ford');
      },
    );

    it('never hardcodes the repository URL in a translation string', () => {
      for (const [locale, bundle] of Object.entries(locales)) {
        expect(JSON.stringify(bundle)).not.toContain('github.com');
        expect(locale).toBeTruthy();
      }
    });
  });
});
