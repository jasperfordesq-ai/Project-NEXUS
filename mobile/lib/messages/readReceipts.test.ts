// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readEventCovers } from './readReceipts';

describe('readEventCovers', () => {
  it('uses the listed ids when the server sends them', () => {
    expect(readEventCovers({ reader_id: 5, message_ids: [2, 3] }, 2)).toBe(true);
    expect(readEventCovers({ reader_id: 5, message_ids: [2, 3] }, 8)).toBe(false);
  });

  it('covers everything up to up_to_message_id otherwise', () => {
    expect(readEventCovers({ reader_id: 5, up_to_message_id: 2 }, 2)).toBe(true);
    expect(readEventCovers({ reader_id: 5, up_to_message_id: 2 }, 8)).toBe(false);
  });

  it('covers everything when no scope is given', () => {
    expect(readEventCovers({ reader_id: 5 }, 8)).toBe(true);
    expect(readEventCovers({ reader_id: 5, up_to_message_id: null }, 8)).toBe(true);
  });
});
