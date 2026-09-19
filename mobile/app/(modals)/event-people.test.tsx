// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';
let mockId: string | string[] | undefined = '7';
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/events/EventPeopleRoster', () => {
  const { Text } = require('react-native');
  return ({ eventId }: { eventId: number }) => <Text testID="people-workspace">{eventId}</Text>;
});
import EventPeopleScreen from './event-people';

it('passes a valid event identity into the dedicated workspace', () => {
  mockId = '42';
  const screen = render(<EventPeopleScreen />);
  expect(screen.getByTestId('people-workspace').props.children).toBe(42);
});
it.each([undefined, '', '0', '-1', '1.5', '1e2', '0x10', '01', '9007199254740992', ['7']].map(id => ({ id })))('refuses malformed identity $id without mounting the workspace', ({ id }) => {
  mockId = id;
  const screen = render(<EventPeopleScreen />);
  expect(screen.queryByTestId('people-workspace')).toBeNull();
  expect(screen.getByText('Invalid event ID.')).toBeTruthy();
});
