<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // These four legacy views were dumped with a definer that does not
        // exist on staging. Rebuild them as invoker views so the application
        // account can query the live schema. The same SQL is the documented
        // post-restore repair for a database restored under a new name.
        $created = 0;
        foreach (['user_effective_permissions.sql', 'other_invoker_views.sql'] as $file) {
            $sql = file_get_contents(database_path('restore/' . $file));
            if ($sql === false) {
                throw new RuntimeException("Missing view repair SQL: {$file}");
            }
            foreach (explode(';', $sql) as $statement) {
                $statement = trim($statement);
                if ($statement === '') continue;
                if (!preg_match('/\bCREATE\s+OR\s+REPLACE\b/i', $statement)) {
                    throw new RuntimeException("Unexpected view SQL in {$file}");
                }
                DB::statement($statement);
                $created++;
            }
        }
        if ($created !== 4) throw new RuntimeException("Expected four rebuilt views, got {$created}");
    }

    public function down(): void
    {
        // Reinstating the missing definer would break live reads and backups.
        // The rebuilt views are safe to retain if this migration is rolled back.
    }
};
