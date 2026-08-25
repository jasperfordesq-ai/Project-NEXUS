// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { CANONICAL_DELETE_KEYWORD, isDeleteConfirmed } from './deleteConfirmation';

describe('isDeleteConfirmed', () => {
  it('accepts the canonical keyword', () => {
    expect(isDeleteConfirmed('DELETE')).toBe(true);
  });

  it('accepts it in any case, with surrounding space', () => {
    // A member who types "delete" has confirmed. The real gate is the password.
    expect(isDeleteConfirmed('delete')).toBe(true);
    expect(isDeleteConfirmed('  Delete  ')).toBe(true);
  });

  it('accepts the localized keyword the screen asked for', () => {
    // The failure this prevents, from the web app: the code compared against a hardcoded
    // English "DELETE" while some locales translated the on-screen keyword, so members
    // following the instruction in front of them could never unlock deletion.
    expect(isDeleteConfirmed('ELIMINAR', 'ELIMINAR')).toBe(true);
    expect(isDeleteConfirmed('supprimer', 'SUPPRIMER')).toBe(true);
  });

  it('still accepts the canonical keyword when a localized one is in force', () => {
    expect(isDeleteConfirmed('DELETE', 'ELIMINAR')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isDeleteConfirmed('')).toBe(false);
    expect(isDeleteConfirmed('   ')).toBe(false);
    expect(isDeleteConfirmed('delete my account')).toBe(false);
    expect(isDeleteConfirmed('member@example.com')).toBe(false);
    expect(isDeleteConfirmed('ELIMINAR')).toBe(false);
  });

  it('refuses an empty localized keyword rather than matching empty input', () => {
    // A missing translation must not turn the gate into "type nothing to delete".
    expect(isDeleteConfirmed('', '')).toBe(false);
    expect(isDeleteConfirmed('  ', '  ')).toBe(false);
  });

  it('exposes the canonical keyword the screens fall back to', () => {
    expect(CANONICAL_DELETE_KEYWORD).toBe('DELETE');
  });
});
