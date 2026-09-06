// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

import CreateTabFallback from './create';

describe('CreateTabFallback', () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it('redirects to the native quick-create modal', async () => {
    render(<CreateTabFallback />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(modals)/quick-create');
    });
  });
});
