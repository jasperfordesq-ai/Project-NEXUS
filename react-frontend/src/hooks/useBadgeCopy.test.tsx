// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { render, screen, act } from '@testing-library/react';
import es from '../../public/locales/es/badge_copy.json';
import fr from '../../public/locales/fr/badge_copy.json';
import { useBadgeCopy, type BadgeCopySource } from './useBadgeCopy';

function Card({ badge }: { badge: BadgeCopySource }) {
  const { badgeName, badgeDescription } = useBadgeCopy();
  return <div aria-label={badgeName(badge)}>{badgeDescription(badge)}</div>;
}
describe('member badge language', () => {
  it('changes built-in copy and accessible names with the language; preserves custom overrides and missing-key fallback', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'es', fallbackLng: false, resources: { es: { badge_copy: es }, fr: { badge_copy: fr } } });
    const builtin = { name: 'First Exchange', description: 'One exchange', name_code: 'badges.transaction_1.name', description_code: 'badges.transaction_1.description' };
    const view = (badge: BadgeCopySource) => <I18nextProvider i18n={i18n}><Card badge={badge} /></I18nextProvider>;
    const { rerender } = render(view(builtin));
    expect(screen.getByLabelText(es.badges.transaction_1.name)).toHaveTextContent(es.badges.transaction_1.description);
    await act(() => i18n.changeLanguage('fr'));
    expect(screen.getByLabelText(fr.badges.transaction_1.name)).toHaveTextContent(fr.badges.transaction_1.description);
    rerender(view({ ...builtin, name: 'Community Star', name_code: null }));
    expect(screen.getByLabelText('Community Star')).toBeInTheDocument();
    rerender(view({ name: 'Future badge', name_code: 'badges.missing.name' }));
    expect(screen.getByLabelText('Future badge')).toBeInTheDocument();
  });
});
