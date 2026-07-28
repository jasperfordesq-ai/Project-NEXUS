// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Unit tests for the dead barrel-mock scanner.
 *
 * Every assertion runs against a purpose-built fixture tree in a temp dir, never
 * against the live repo — live counts change as remediation lands, and a test
 * pinned to them would break on every fix.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AUDITED_BARRELS, classifyRisk, compareToBaseline, scan, toBaseline } from './audit-dead-mocks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'audit-dead-mocks.mjs');

const UI_BARREL = `
export { GlassCard } from './GlassCard';
export { Button } from './Button';
export { Chip } from './Chip';
export { useConfirm, ConfirmDialogProvider } from './ConfirmDialog';
export { ToggleButtonGroup, ToggleButton } from './ToggleButtonGroup';
export { Textarea as TextArea } from './Textarea';
`;

const CONTEXTS_BARREL = `
export { TenantProvider, useTenant } from './TenantContext';
export { AuthProvider, useAuth } from './AuthContext';
export { ToastProvider, useToast } from './ToastContext';
`;

// The fixture must provide a directory for EVERY entry in AUDITED_BARRELS, or the
// scanner reports the missing ones as unresolved and the blind-scan assertions
// below stop measuring what they claim to. Added with '@/admin/components'.
const ADMIN_BARREL = `
export { PageHeader } from './PageHeader';
export { StatCard } from './StatCard';
`;

/**
 * Writes a minimal react-frontend tree: the two audited barrels, their
 * submodules, plus whatever component/test files a case needs.
 */
function writeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-dead-mocks-'));
  const src = path.join(root, 'src');

  const base = {
    'components/ui/Button.tsx': 'export function Button() { return null; }\n',
    'components/ui/Chip.tsx': 'export function Chip() { return null; }\n',
    'components/ui/ConfirmDialog.tsx':
      'export function useConfirm() { throw new Error("provider"); }\n' +
      'export function ConfirmDialogProvider() { return null; }\n',
    'components/ui/GlassCard.tsx': 'export function GlassCard() { return null; }\n',
    'components/ui/Textarea.tsx': 'export function Textarea() { return null; }\n',
    'components/ui/ToggleButtonGroup.tsx':
      'export function ToggleButtonGroup() { return null; }\nexport function ToggleButton() { return null; }\n',
    'components/ui/index.ts': UI_BARREL,
    'contexts/AuthContext.tsx': 'export function useAuth() { return null; }\nexport function AuthProvider() { return null; }\n',
    'contexts/PusherContext.tsx': 'export function usePusherOptional() { return null; }\n',
    'contexts/TenantContext.tsx':
      'export function useTenant() { throw new Error("useTenant must be used within a TenantProvider"); }\n' +
      'export function TenantProvider() { return null; }\n',
    'contexts/ToastContext.tsx': 'export function useToast() { return null; }\nexport function ToastProvider() { return null; }\n',
    'contexts/index.ts': CONTEXTS_BARREL,
    'admin/components/PageHeader.tsx': 'export function PageHeader() { return null; }\n',
    'admin/components/StatCard.tsx': 'export function StatCard() { return null; }\n',
    'admin/components/index.ts': ADMIN_BARREL,
    'test/uiMock.tsx': 'export const uiMock = {} as Record<string, unknown>;\n',
  };

  for (const [relative, contents] of Object.entries({ ...base, ...files })) {
    const target = path.join(src, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  }

  return root;
}

function rowsFor(root, options = {}) {
  return scan({ root, ...options }).rows;
}

test('flags an override the component bypasses via the direct path', () => {
  const root = writeFixture({
    'components/jobs/OwnerBanner.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function OwnerBanner() { useConfirm(); return null; }
    `,
    'components/jobs/OwnerBanner.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { OwnerBanner } from './OwnerBanner';
    `,
  });

  const rows = rowsFor(root);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      barrel: rows[0].barrel,
      deadKey: rows[0].deadKey,
      depth: rows[0].depth,
      directPath: rows[0].directPath,
      importingModule: rows[0].importingModule,
      riskClass: rows[0].riskClass,
      testFile: rows[0].testFile,
    },
    {
      barrel: '@/components/ui',
      deadKey: 'useConfirm',
      depth: 1,
      directPath: '@/components/ui/ConfirmDialog',
      importingModule: 'src/components/jobs/OwnerBanner.tsx',
      riskClass: 'R1',
      testFile: 'src/components/jobs/OwnerBanner.test.tsx',
    },
  );
});

test('does NOT flag a test that also mocks the direct path', () => {
  const root = writeFixture({
    'components/jobs/OwnerBanner.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function OwnerBanner() { useConfirm(); return null; }
    `,
    'components/jobs/OwnerBanner.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));
      import { OwnerBanner } from './OwnerBanner';
    `,
  });

  const result = scan({ root });
  assert.deepEqual(result.rows, []);
  assert.equal(result.correctlyHandledCount, 1);
});

test('does NOT flag the sanctioned uiMock handoff form', () => {
  const root = writeFixture({
    'components/jobs/OwnerBanner.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function OwnerBanner() { useConfirm(); return null; }
    `,
    'components/jobs/OwnerBanner.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);
      import { OwnerBanner } from './OwnerBanner';
    `,
  });

  assert.deepEqual(rowsFor(root), []);
});

test('does NOT flag a spread-only factory (zero explicit overrides)', () => {
  const root = writeFixture({
    'components/jobs/OwnerBanner.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function OwnerBanner() { useConfirm(); return null; }
    `,
    'components/jobs/OwnerBanner.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({ ...(await importOriginal()) }));
      import { OwnerBanner } from './OwnerBanner';
    `,
  });

  assert.deepEqual(rowsFor(root), []);
});

test('does NOT flag type-only imports, re-exports, or barrel imports', () => {
  const root = writeFixture({
    'components/jobs/Types.ts': `
      export type { GlassCard } from '@/components/ui/GlassCard';
    `,
    'components/jobs/ReExport.ts': `
      export { Chip } from '@/components/ui/Chip';
    `,
    'components/jobs/Banner.tsx': `
      import type { Button } from '@/components/ui/Button';
      import { GlassCard } from '@/components/ui';
      export function Banner() { return GlassCard as unknown as null; }
    `,
    'components/jobs/Banner.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        Button: () => null,
        Chip: () => null,
        GlassCard: () => null,
      }));
      import { Banner } from './Banner';
      import './ReExport';
      import './Types';
    `,
  });

  assert.deepEqual(rowsFor(root), []);
});

test('records depth 2 as depth 2 for a nested child component', () => {
  const root = formDepthFixture();

  const rows = rowsFor(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].depth, 2);
  assert.equal(rows[0].deadKey, 'useConfirm');
  assert.equal(rows[0].importingModule, 'src/pages/jobs/Child.tsx');
});

test('a depth-2 offender falls outside the enforced scope at --max-depth 1', () => {
  const root = formDepthFixture();

  const result = scan({ maxDepth: 1, root });
  assert.deepEqual(result.rows, []);
  assert.equal(result.deepRows.length, 1);
  assert.equal(result.deepRows[0].depth, 2);
});

function formDepthFixture() {
  return writeFixture({
    'pages/jobs/Child.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Child() { useConfirm(); return null; }
    `,
    'pages/jobs/Parent.tsx': `
      import { Child } from './Child';
      export function Parent() { return Child as unknown as null; }
    `,
    'pages/jobs/Parent.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Parent } from './Parent';
    `,
  });
}

test('treats a mocked intermediate module as a traversal barrier', () => {
  const root = writeFixture({
    'pages/jobs/Child.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Child() { useConfirm(); return null; }
    `,
    'pages/jobs/Parent.tsx': `
      import { Child } from './Child';
      export function Parent() { return Child as unknown as null; }
    `,
    'pages/jobs/Parent.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      vi.mock('./Child', () => ({ Child: () => null }));
      import { Parent } from './Parent';
    `,
  });

  assert.deepEqual(rowsFor(root), []);
});

test('follows the barrel alias so `Textarea as TextArea` still resolves', () => {
  const root = writeFixture({
    'pages/jobs/Notes.tsx': `
      import { Textarea } from '@/components/ui/Textarea';
      export function Notes() { return Textarea as unknown as null; }
    `,
    'pages/jobs/Notes.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        TextArea: () => null,
      }));
      import { Notes } from './Notes';
    `,
  });

  const rows = rowsFor(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deadKey, 'TextArea');
  assert.equal(rows[0].importedName, 'Textarea');
  assert.equal(rows[0].directPath, '@/components/ui/Textarea');
});

test('flags a key the barrel never exports (dead by construction)', () => {
  const root = writeFixture({
    'pages/feed/FeedPage.tsx': `
      import { usePusherOptional } from '@/contexts/PusherContext';
      export function FeedPage() { usePusherOptional(); return null; }
    `,
    'pages/feed/FeedPage.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/contexts', () => ({ usePusherOptional: () => null }));
      import { FeedPage } from './FeedPage';
    `,
  });

  const rows = rowsFor(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].barrel, '@/contexts');
  assert.equal(rows[0].deadKey, 'usePusherOptional');
  assert.equal(rows[0].barrelExportsKey, false);
  assert.equal(rows[0].directPath, '@/contexts/PusherContext');
});

test('does NOT flag src/test harness modules that mount real providers', () => {
  const root = writeFixture({
    'test/test-utils.tsx': `
      import { ToastProvider } from '@/contexts/ToastContext';
      export const AllProviders = ToastProvider;
    `,
    'pages/jobs/Page.tsx': 'export function Page() { return null; }\n',
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      import { AllProviders } from '@/test/test-utils';
      vi.mock('@/contexts', () => ({ ToastProvider: () => null, useToast: () => ({}) }));
      import { Page } from './Page';
    `,
  });

  assert.deepEqual(rowsFor(root), []);
});

test('sets testWrapsRealProvider when the graph loads the real provider', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useTenant } from '@/contexts/TenantContext';
      export function Page() { useTenant(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      import { TenantProvider } from '@/contexts/TenantContext';
      vi.mock('@/contexts', () => ({ useTenant: () => ({}) }));
      import { Page } from './Page';
    `,
  });

  const rows = rowsFor(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].testWrapsRealProvider, true);
});

test('classifies control-flow, identity and cosmetic keys', () => {
  assert.equal(classifyRisk('useConfirm'), 'R1');
  assert.equal(classifyRisk('useDisclosure'), 'R1');
  assert.equal(classifyRisk('ModalFooter'), 'R1');
  assert.equal(classifyRisk('DropdownItem'), 'R1');
  assert.equal(classifyRisk('Tabs'), 'R1');
  assert.equal(classifyRisk('useTenant'), 'R1');
  assert.equal(classifyRisk('SearchField'), 'R2');
  assert.equal(classifyRisk('ToggleButtonGroup'), 'R2');
  assert.equal(classifyRisk('SelectItem'), 'R2');
  assert.equal(classifyRisk('TableRow'), 'R2');
  assert.equal(classifyRisk('GlassCard'), 'R2');
  assert.equal(classifyRisk('Button'), 'R3');
  assert.equal(classifyRisk('Spinner'), 'R3');
  assert.equal(classifyRisk('Tab'), 'R1');
});

test('handles the `vi.mock(import(...), factory)` spelling', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock(import('@/components/ui'), async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Page } from './Page';
    `,
  });

  const rows = rowsFor(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deadKey, 'useConfirm');
});

test('reads keys out of a block-bodied factory with a local object', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
      export function Page() { return ToggleButtonGroup as unknown as null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => {
        const actual = await importOriginal();
        const overrides = { ToggleButtonGroup: () => null };
        return overrides;
      });
      import { Page } from './Page';
    `,
  });

  const rows = rowsFor(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deadKey, 'ToggleButtonGroup');
  assert.equal(rows[0].riskClass, 'R2');
});

test('baseline comparison passes on an unchanged tree and fails on a new offender', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Page } from './Page';
    `,
  });

  const baseline = toBaseline(scan({ root }));
  assert.match(baseline._README, /never hand-edit/i);
  assert.deepEqual(baseline.offenders, {
    'src/pages/jobs/Page.test.tsx': { '@/components/ui': ['useConfirm'] },
  });
  assert.equal(baseline.totals.rowCount, 1);

  const unchanged = compareToBaseline(scan({ root }), baseline);
  assert.equal(unchanged.ok, true);
  assert.deepEqual(unchanged.newOffenders, []);

  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'jobs', 'Other.tsx'),
    "import { GlassCard } from '@/components/ui/GlassCard';\nexport function Other() { return GlassCard as unknown as null; }\n",
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'jobs', 'Other.test.tsx'),
    "import { vi } from 'vitest';\n" +
      "vi.mock('@/components/ui', async (importOriginal) => ({ ...(await importOriginal()), GlassCard: () => null }));\n" +
      "import { Other } from './Other';\n",
    'utf8',
  );

  const regressed = compareToBaseline(scan({ root }), baseline);
  assert.equal(regressed.ok, false);
  assert.equal(regressed.countRegression, true);
  assert.equal(regressed.newOffenders.length, 1);
  assert.equal(regressed.newOffenders[0].testFile, 'src/pages/jobs/Other.test.tsx');
  assert.equal(regressed.newOffenders[0].deadKey, 'GlassCard');
});

test('baseline comparison reports fixed keys without failing', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Page } from './Page';
    `,
  });

  const baseline = toBaseline(scan({ root }));

  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'jobs', 'Page.tsx'),
    "import { useConfirm } from '@/components/ui';\nexport function Page() { useConfirm(); return null; }\n",
    'utf8',
  );

  const comparison = compareToBaseline(scan({ root }), baseline);
  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.fixedKeys, ['src/pages/jobs/Page.test.tsx|@/components/ui|useConfirm']);
});

test('CLI --baseline writes a file and --check then exits 0; a new offender exits 1', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Page } from './Page';
    `,
  });

  const generate = spawnSync(process.execPath, [scriptPath, '--root', root, '--baseline'], {
    encoding: 'utf8',
  });
  assert.equal(generate.status, 0, generate.stderr);
  assert.match(generate.stdout, /Wrote baseline src\/test\/dead-barrel-mocks\.baseline\.json/);
  assert.ok(fs.existsSync(path.join(root, 'src', 'test', 'dead-barrel-mocks.baseline.json')));

  const clean = spawnSync(process.execPath, [scriptPath, '--root', root, '--check'], {
    encoding: 'utf8',
  });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /ratchet OK/);

  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'jobs', 'Other.tsx'),
    "import { GlassCard } from '@/components/ui/GlassCard';\nexport function Other() { return GlassCard as unknown as null; }\n",
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'jobs', 'Other.test.tsx'),
    "import { vi } from 'vitest';\n" +
      "vi.mock('@/components/ui', async (importOriginal) => ({ ...(await importOriginal()), GlassCard: () => null }));\n" +
      "import { Other } from './Other';\n",
    'utf8',
  );

  const dirty = spawnSync(process.execPath, [scriptPath, '--root', root, '--check'], {
    encoding: 'utf8',
  });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /ratchet FAILED/);
  assert.match(dirty.stderr, /Other\.test\.tsx/);
  assert.match(dirty.stderr, /@\/components\/ui\/GlassCard/);
});

test('CLI --json emits parseable rows on stdout', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Page } from './Page';
    `,
  });

  const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].deadKey, 'useConfirm');
  assert.equal(payload.summary.byRisk.R1, 1);
});

// ─── total-shape helper factories (createMockContexts) ──────────────────────
//
// The repo's own `vi.mock('@/contexts', () => createMockContexts({ … }))` form.
// It is NOT a partial mock: the helper returns `{ ...DEFAULTS, ...overrides }`,
// i.e. the whole barrel. Reading only the explicit argument keys (or, worse,
// treating the concise call body as a zero-override handoff) hid ~640 call
// sites — including LegalAcceptanceGate's real `useTenant` leak.

const MOCK_CONTEXTS_HELPER = `
  const DEFAULTS = {
    useAuth: () => ({ user: null }),
    useTenant: () => ({ tenant: null }),
    useToast: () => ({ success: () => {} }),
  };
  export function createMockContexts(overrides = {}) {
    const merged = { ...DEFAULTS, ...overrides };
    return merged;
  }
`;

const GATE_COMPONENT = `
  import { useTenant } from '@/contexts/TenantContext';
  export function Gate() { useTenant(); return null; }
`;

test('decodes a total-shape helper: a DEFAULTS key the test never named is still dead', () => {
  const root = writeFixture({
    'test/mock-contexts.ts': MOCK_CONTEXTS_HELPER,
    'components/legal/Gate.tsx': GATE_COMPONENT,
    'components/legal/Gate.test.tsx': `
      import { vi } from 'vitest';
      import { createMockContexts } from '@/test/mock-contexts';
      vi.mock('@/contexts', () => createMockContexts({ useToast: () => ({}) }));
      import { Gate } from './Gate';
    `,
  });

  const result = scan({ root });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].barrel, '@/contexts');
  // useTenant is in DEFAULTS only — the test never wrote it.
  assert.equal(result.rows[0].deadKey, 'useTenant');
  assert.equal(result.rows[0].directPath, '@/contexts/TenantContext');
  assert.equal(result.unresolvedFactoryCount, 0);
  assert.deepEqual(result.unresolvedBarrels, []);
  // Derived, not hardcoded: the fixture provides every audited barrel, so adding
  // one to AUDITED_BARRELS must not require editing this number.
  assert.equal(result.auditedBarrelCount, AUDITED_BARRELS.length);
});

test('decodes a total-shape helper pulled in by require() inside the factory', () => {
  const root = writeFixture({
    'test/mock-contexts.ts': MOCK_CONTEXTS_HELPER,
    'components/legal/Gate.tsx': GATE_COMPONENT,
    'components/legal/Gate.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/contexts', () => {
        const { createMockContexts } = require('@/test/mock-contexts');
        return createMockContexts();
      });
      import { Gate } from './Gate';
    `,
  });

  const result = scan({ root });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].deadKey, 'useTenant');
  assert.equal(result.unresolvedFactoryCount, 0);
});

test('decodes a total-shape helper aliased through a dynamic import', () => {
  const root = writeFixture({
    'test/mock-contexts.ts': MOCK_CONTEXTS_HELPER,
    'components/legal/Gate.tsx': GATE_COMPONENT,
    'components/legal/Gate.test.tsx': `
      import { vi } from 'vitest';
      it('re-mocks', async () => {
        const { createMockContexts: cmc } = await import('@/test/mock-contexts');
        vi.doMock('@/contexts', () => cmc({ useToast: () => ({}) }));
      });
      import { Gate } from './Gate';
    `,
  });

  const result = scan({ root });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].deadKey, 'useTenant');
  assert.equal(result.unresolvedFactoryCount, 0);
});

test('an undecodable helper call keeps its explicit keys AND is counted unresolved', () => {
  const root = writeFixture({
    'components/legal/Gate.tsx': GATE_COMPONENT,
    'components/legal/Gate.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/contexts', () => buildContexts({ useTenant: () => ({}) }));
      import { Gate } from './Gate';
    `,
  });

  const result = scan({ root });
  // The explicit argument key still produces a row…
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].deadKey, 'useTenant');
  // …but the factory's full shape was NOT decoded, so say so out loud rather
  // than reporting it as "understood, zero overrides".
  assert.equal(result.unresolvedFactoryCount, 1);
  assert.equal(result.unresolvedFactories[0].barrel, '@/contexts');
  assert.equal(result.unresolvedFactories[0].testFile, 'src/components/legal/Gate.test.tsx');
});

test('a Proxy-returning factory is an unresolved blind spot, not a clean handoff', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async () => {
        const base = (await import('@/test/uiMock')).uiMock;
        const overrides = { useConfirm: () => null };
        return new Proxy(base, { get: (t, p) => (p in overrides ? overrides[p] : t[p]) });
      });
      import { Page } from './Page';
    `,
  });

  const result = scan({ root });
  assert.deepEqual(result.rows, []);
  assert.equal(result.unresolvedFactoryCount, 1);
});

test('still recognises the block-bodied uiMock handoff', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async () => {
        const { uiMock } = await import('@/test/uiMock');
        return uiMock;
      });
      import { Page } from './Page';
    `,
  });

  const result = scan({ root });
  assert.deepEqual(result.rows, []);
  assert.equal(result.unresolvedFactoryCount, 0);
});

// ─── blind-scan canaries ────────────────────────────────────────────────────
//
// Renaming a barrel index used to drop detection to zero rows with no signal at
// all, which reads identically to "the repo is clean" and silently disarms the
// ratchet in BarrelMock.contract.test.ts.

test('surfaces an audited barrel whose index cannot be resolved', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Page } from './Page';
    `,
  });

  assert.equal(scan({ root }).rows.length, 1);

  fs.renameSync(
    path.join(root, 'src', 'components', 'ui', 'index.ts'),
    path.join(root, 'src', 'components', 'ui', 'barrel.ts'),
  );

  const blind = scan({ root });
  assert.deepEqual(blind.rows, [], 'rows evaporate — that is the failure mode');
  assert.deepEqual(blind.unresolvedBarrels, ['@/components/ui']);
  // Every other audited barrel still resolves; only the one hidden above is lost.
  assert.equal(blind.auditedBarrelCount, AUDITED_BARRELS.length - 1);
  // testFileCount alone cannot see this vector: the tests are all still there.
  assert.equal(blind.testFileCount, 1);
});

test('CLI refuses to run or rebaseline while a barrel is unresolved', () => {
  const root = writeFixture({
    'pages/jobs/Page.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Page() { useConfirm(); return null; }
    `,
    'pages/jobs/Page.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Page } from './Page';
    `,
  });

  fs.rmSync(path.join(root, 'src', 'contexts', 'index.ts'));

  for (const mode of ['--check', '--baseline']) {
    const run = spawnSync(process.execPath, [scriptPath, '--root', root, mode], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 1, `${mode} should fail loudly`);
    assert.match(run.stderr, /BLIND/);
    assert.match(run.stderr, /@\/contexts/);
  }
  assert.ok(!fs.existsSync(path.join(root, 'src', 'test', 'dead-barrel-mocks.baseline.json')));
});

test('baseline paths use forward slashes so the artifact is machine-stable', () => {
  const root = writeFixture({
    'pages/jobs/nested/Deep.tsx': `
      import { useConfirm } from '@/components/ui/ConfirmDialog';
      export function Deep() { useConfirm(); return null; }
    `,
    'pages/jobs/nested/Deep.test.tsx': `
      import { vi } from 'vitest';
      vi.mock('@/components/ui', async (importOriginal) => ({
        ...(await importOriginal()),
        useConfirm: () => mockConfirm,
      }));
      import { Deep } from './Deep';
    `,
  });

  const serialized = JSON.stringify(toBaseline(scan({ root })));
  assert.ok(serialized.includes('src/pages/jobs/nested/Deep.test.tsx'));
  assert.ok(!serialized.includes('\\\\'));
});
