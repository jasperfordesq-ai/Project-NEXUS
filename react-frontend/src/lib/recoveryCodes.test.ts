// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRecoveryCodesFile, downloadRecoveryCodes, recoveryCodesFilename } from './recoveryCodes';

const FILE = {
  title: 'Project NEXUS recovery codes',
  generated: 'Generated 12 September 2026',
  guidance: 'Each code works once. They are not shown again.',
  codes: ['aaaa-1111', 'bbbb-2222', 'cccc-3333'],
};

describe('buildRecoveryCodesFile', () => {
  const text = buildRecoveryCodesFile(FILE);
  // CRLF by default (see the helper): Windows Notepad renders LF-only text as one
  // unbroken line, which would make the codes unreadable to someone already locked out.
  const lines = text.split('\r\n');

  it('puts every code on its own line', () => {
    for (const code of FILE.codes) expect(lines).toContain(code);
  });

  it('leads with the supplied heading, date and guidance', () => {
    expect(lines[0]).toBe(FILE.title);
    expect(lines[1]).toBe(FILE.generated);
    expect(lines).toContain(FILE.guidance);
  });

  it('separates lines with CRLF by default, and honours an explicit LF', () => {
    expect(text).toContain('\r\n');
    expect(buildRecoveryCodesFile(FILE, { lineEnding: '\n' })).not.toContain('\r');
  });

  it('ends with a newline, so the last code is not glued to whatever follows it', () => {
    expect(text.endsWith('\n')).toBe(true);
  });

  // 🔴 The file leaves the device and may be kept for years. It carries the codes and
  // the words the caller passed, and nothing else — no email address, no member id, no
  // community name unless the caller put one in the heading itself.
  it('contains only the parts it was given', () => {
    const accounted = [FILE.title, FILE.generated, FILE.guidance, ...FILE.codes];
    const leftovers = lines.map(line => line.trim()).filter(Boolean)
      .filter(line => !accounted.includes(line));
    expect(leftovers).toEqual([]);
  });

  it('writes Windows line endings, because Notepad is where these get opened', () => {
    expect(buildRecoveryCodesFile(FILE, { lineEnding: '\r\n' })).toContain('\r\naaaa-1111\r\n');
  });
});

describe('recoveryCodesFilename', () => {
  it('names the file by date, with no account detail in it', () => {
    expect(recoveryCodesFilename(new Date('2026-09-12T10:00:00Z'))).toBe('recovery-codes-2026-09-12.txt');
  });
});

describe('downloadRecoveryCodes', () => {
  afterEach(() => vi.restoreAllMocks());

  function harness() {
    const anchor = { click: vi.fn(), href: '', download: '', rel: '', style: {} } as unknown as HTMLAnchorElement;
    const documentRef = {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    } as unknown as Document;
    const createObjectURL = vi.fn(() => 'blob:nexus/1');
    const revokeObjectURL = vi.fn();
    return { anchor, documentRef, createObjectURL, revokeObjectURL };
  }

  it('hands the browser a blob built in memory, never a URL it could fetch or cache', () => {
    const h = harness();
    const blobs: Blob[] = [];
    downloadRecoveryCodes(FILE, 'recovery-codes-2026-09-12.txt', {
      documentRef: h.documentRef,
      createObjectURL: (blob: Blob) => { blobs.push(blob); return h.createObjectURL(); },
      revokeObjectURL: h.revokeObjectURL,
    });

    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe('text/plain;charset=utf-8');
    expect(h.anchor.href).toBe('blob:nexus/1');
    expect(h.anchor.download).toBe('recovery-codes-2026-09-12.txt');
    expect(h.anchor.click).toHaveBeenCalledTimes(1);
  });

  // An object URL left alive keeps the codes readable to anything that can guess it,
  // for the lifetime of the document.
  it('revokes the object URL afterwards', () => {
    const h = harness();
    downloadRecoveryCodes(FILE, 'x.txt', {
      documentRef: h.documentRef, createObjectURL: h.createObjectURL, revokeObjectURL: h.revokeObjectURL,
    });
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:nexus/1');
  });

  it('revokes it even when the click throws, and lets the caller see the failure', () => {
    const h = harness();
    (h.anchor.click as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('blocked'); });
    expect(() => downloadRecoveryCodes(FILE, 'x.txt', {
      documentRef: h.documentRef, createObjectURL: h.createObjectURL, revokeObjectURL: h.revokeObjectURL,
    })).toThrow('blocked');
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:nexus/1');
  });

  it('takes the anchor back out of the page', () => {
    const h = harness();
    downloadRecoveryCodes(FILE, 'x.txt', {
      documentRef: h.documentRef, createObjectURL: h.createObjectURL, revokeObjectURL: h.revokeObjectURL,
    });
    expect(h.documentRef.body.removeChild).toHaveBeenCalledWith(h.anchor);
  });

  it('refuses to build an empty file, which would look like a saved backup and hold nothing', () => {
    const h = harness();
    expect(() => downloadRecoveryCodes({ ...FILE, codes: [] }, 'x.txt', {
      documentRef: h.documentRef, createObjectURL: h.createObjectURL, revokeObjectURL: h.revokeObjectURL,
    })).toThrow(/no recovery codes/i);
    expect(h.createObjectURL).not.toHaveBeenCalled();
  });
});
