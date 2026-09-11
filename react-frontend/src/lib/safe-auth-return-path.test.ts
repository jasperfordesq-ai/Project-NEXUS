// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { expect, it } from 'vitest';
import { safeAuthReturnPath } from './safe-auth-return-path';

it.each(['//evil.test', '/\\evil.test', '/%5cevil.test', '/%2fevil.test', '/%255cevil.test', '/\nevil.test', 'https://evil.test', 'javascript:alert(1)', {}, null])('rejects unsafe authentication destination %s', value => {
  expect(safeAuthReturnPath(value, '/community/feed')).toBe('/community/feed');
});
it('preserves a local destination with a query and fragment', () => {
  expect(safeAuthReturnPath('/community/events?q=hello%20world#details', '/')).toBe('/community/events?q=hello%20world#details');
});
