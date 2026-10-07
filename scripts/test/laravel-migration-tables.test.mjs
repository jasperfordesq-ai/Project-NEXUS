// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAddedColumns, parseCreatedTables } from '../lib/laravel-migration-tables.mjs';

test('recognizes columns added to an existing table, including inside hasColumn guards', () => {
  const migration = `
    Schema::table('vol_certificates', function (Blueprint $table) {
        if (!Schema::hasColumn('vol_certificates', 'revoked_at')) {
            $table->dateTime('revoked_at')->nullable();
        }
        $table->unsignedInteger('revoked_by')->nullable();
        $table->dropColumn('old_column');
        $table->index(['tenant_id']);
    });
  `;

  assert.deepEqual([...parseAddedColumns(migration).get('vol_certificates')], ['revoked_at', 'revoked_by']);
});

test('reads no added columns from a create or a drop-only alter', () => {
  assert.equal(parseAddedColumns(`
    Schema::create('brand_new', function (Blueprint $table): void {
      $table->id();
    });
    Schema::table('users', function (Blueprint $table): void {
      $table->dropColumn('nickname');
    });
  `).size, 0);
});

test('recognizes literal columns in a pending Laravel table migration', () => {
  const migration = `
    Schema::create('federation_debit_approvals', function (Blueprint $table): void {
      $table->id();
      $table->unsignedBigInteger('tenant_id');
      $table->string('protocol', 32);
      $table->decimal('amount', 12, 4);
      $table->timestamps();
      $table->unique(['tenant_id', 'protocol']);
    });
  `;

  assert.deepEqual([...parseCreatedTables(migration).get('federation_debit_approvals')], [
    'id', 'tenant_id', 'protocol', 'amount', 'created_at', 'updated_at',
  ]);
});

test('does not invent a table from an alter or drop migration', () => {
  assert.equal(parseCreatedTables(`
    Schema::table('users', function (Blueprint $table): void {
      $table->string('nickname');
    });
    Schema::dropIfExists('missing_table');
  `).size, 0);
});

test('does not treat a commented create call as a table', () => {
  assert.equal(parseCreatedTables(`
    // Schema::create('imaginary', function (Blueprint $table): void {
    //   $table->id();
    // });
  `).size, 0);
});
