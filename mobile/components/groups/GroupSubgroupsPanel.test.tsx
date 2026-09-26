// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import GroupSubgroupsPanel from './GroupSubgroupsPanel';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#005EB8' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#333', textMuted: '#555' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => vars?.name ? `${key}:${vars.name}` : key }) }));

const child = {
  id: 12,
  name: 'North district',
  description: 'Local activity',
  image_url: null,
  visibility: 'public',
  member_count: 8,
  type_id: null,
  parent_id: 4,
};

describe('GroupSubgroupsPanel', () => {
  beforeEach(() => mockPush.mockClear());

  it('opens the exact child group', () => {
    const screen = render(<GroupSubgroupsPanel groupId={4} subgroups={[child]} />);
    fireEvent.press(screen.getByLabelText('detail.subgroups.open:North district'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/group-detail', params: { id: '12' } });
  });

  it.each([
    [{ ...child, parent_id: 99 }],
    [{ ...child, id: 4 }],
    [{ ...child, name: '' }],
    [{ ...child, member_count: -1 }],
  ])('fails closed for malformed or cross-parent rows', (rows) => {
    const screen = render(<GroupSubgroupsPanel groupId={4} subgroups={rows} />);
    expect(screen.queryByTestId('group-subgroups-panel')).toBeNull();
  });
});
