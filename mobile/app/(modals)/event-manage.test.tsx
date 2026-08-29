// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { eventManagementRoute } from './event-manage';

describe('eventManagementRoute', () => {
  it('routes dedicated native management workspaces without losing the event id', () => {
    expect(eventManagementRoute(42, 'check-in')).toEqual({ pathname: '/(modals)/event-attendance', params: { id: '42' } });
    expect(eventManagementRoute(42, 'tickets')).toEqual({ pathname: '/(modals)/event-tickets', params: { id: '42' } });
    expect(eventManagementRoute(42, 'communications')).toEqual({ pathname: '/(modals)/event-communications', params: { id: '42' } });
    expect(eventManagementRoute(42, 'series-definitions')).toEqual({ pathname: '/(modals)/event-recurrence-blueprints', params: { id: '42' } });
  });

  it('routes embedded management sections to the canonical event workspace', () => {
    expect(eventManagementRoute(42, 'agenda')).toEqual({ pathname: '/(modals)/event-detail', params: { id: '42' } });
    expect(eventManagementRoute(42, 'registration')).toEqual({ pathname: '/(modals)/event-detail', params: { id: '42' } });
    expect(eventManagementRoute(42, 'overview')).toBeNull();
  });
});
