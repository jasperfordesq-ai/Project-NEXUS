// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getExchangeWorkflowConfig } from '@/lib/api/exchanges';
import { useHelpGateContext } from './useHelpGateContext';

const authState = {
  isAuthenticated: true,
  user: { id: 41 },
};
const tenantState = {
  tenantSlug: 'first-community',
  hasFeature: () => true,
  hasModule: () => true,
};

jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => authState }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => tenantState }));
jest.mock('@/lib/api/exchanges', () => ({ getExchangeWorkflowConfig: jest.fn() }));

const mockGetConfig = getExchangeWorkflowConfig as jest.MockedFunction<typeof getExchangeWorkflowConfig>;

describe('useHelpGateContext', () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.user = { id: 41 };
    tenantState.tenantSlug = 'first-community';
    mockGetConfig.mockReset();
  });

  it('does not carry an exchange setting into another community', async () => {
    let resolveSecond!: (value: { data: { exchange_workflow_enabled: boolean } }) => void;
    mockGetConfig
      .mockResolvedValueOnce({ data: { exchange_workflow_enabled: false } } as never)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve as typeof resolveSecond;
      }) as never);

    const { result, rerender } = renderHook(() => useHelpGateContext());
    await waitFor(() => expect(result.current.hasSetting?.('exchange_workflow')).toBe(false));

    tenantState.tenantSlug = 'second-community';
    rerender({});

    await waitFor(() => expect(mockGetConfig).toHaveBeenCalledTimes(2));
    expect(result.current.hasSetting?.('exchange_workflow')).toBe(true);

    await act(async () => {
      resolveSecond({ data: { exchange_workflow_enabled: true } });
    });
    expect(result.current.hasSetting?.('exchange_workflow')).toBe(true);
  });
});
