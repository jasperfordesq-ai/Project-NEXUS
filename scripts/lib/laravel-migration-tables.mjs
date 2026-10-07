// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const COLUMN_METHODS = new Set([
  'bigInteger', 'boolean', 'char', 'date', 'dateTime', 'decimal', 'double',
  'enum', 'float', 'foreignId', 'integer', 'ipAddress', 'json', 'longText',
  'mediumText', 'smallInteger', 'string', 'text', 'time', 'timestamp',
  'tinyInteger', 'unsignedBigInteger', 'unsignedInteger', 'uuid',
]);

// Recognize only literal Schema::create declarations. Unrecognized migration
// shapes remain absent from the check rather than being assumed valid.
export function parseCreatedTables(source) {
  const tables = new Map();
  const create = /^\s*Schema::create\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*,\s*function\s*\([^)]*\)\s*(?::\s*void)?\s*\{([\s\S]*?)^\s*\}\s*\)\s*;/gm;

  for (const match of source.matchAll(create)) {
    const columns = new Set();
    const columnCall = /^\s*\$table->([A-Za-z][A-Za-z0-9_]*)\(\s*(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\2)?/gm;
    for (const call of match[3].matchAll(columnCall)) {
      const method = call[1];
      const name = call[3];
      if (COLUMN_METHODS.has(method) && name) columns.add(name);
      if (method === 'id') columns.add(name ?? 'id');
      if (method === 'timestamps' || method === 'nullableTimestamps') {
        columns.add('created_at');
        columns.add('updated_at');
      }
      if (method === 'softDeletes') columns.add(name ?? 'deleted_at');
    }
    if (columns.size > 0) tables.set(match[2], columns);
  }

  return tables;
}

// Columns a migration ADDS to an existing table, from literal Schema::table
// declarations (7 Oct 2026). The committed dump comes from production, so a
// column added by a migration that has not been deployed yet was missing from
// the check, and code using it failed until the next production dump. Only
// literal column-creating calls count; drops and renames are ignored, so this
// can only ever widen what is known, never narrow it.
export function parseAddedColumns(source) {
  const tables = new Map();
  const alter = /^\s*Schema::table\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*,\s*function\s*\([^)]*\)\s*(?::\s*void)?\s*\{([\s\S]*?)^\s*\}\s*\)\s*;/gm;

  for (const match of source.matchAll(alter)) {
    const columnCall = /^\s*\$table->([A-Za-z][A-Za-z0-9_]*)\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2/gm;
    for (const call of match[3].matchAll(columnCall)) {
      if (!COLUMN_METHODS.has(call[1])) continue;
      if (!tables.has(match[2])) tables.set(match[2], new Set());
      tables.get(match[2]).add(call[3]);
    }
  }

  return tables;
}
