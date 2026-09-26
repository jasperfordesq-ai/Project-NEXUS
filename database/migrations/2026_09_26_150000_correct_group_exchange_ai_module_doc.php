<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Services\AI\AiModuleDocsService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Corrects the AI assistant's built-in "group exchanges" grounding text.
 *
 * Each community gets its own copy of the default AI module docs when it is
 * created, so fixing the default in AiModuleDocsService only reaches new
 * communities. The old text described a 'beneficiary', payment 'from a
 * community pool' and per-contributor actual hours — none of which exist —
 * so members asking the assistant were told how a different feature works.
 *
 * Only rows still carrying the old default body are updated. A row an admin
 * has edited is left exactly as it is.
 */
return new class extends Migration
{
    private const OLD_BODY = "Group Exchanges (/group-exchanges) are larger collaborative projects where multiple members work together towards a shared outcome and split the time credits — distinct from one-to-one Listings.\n\nExamples: a community garden build (5 members, 4 hours each), painting a community hall (3 members across 2 weekends), running a school holiday camp (8 volunteers across 5 days), translating a community document into 4 languages.\n\nHow it works:\n1. A coordinator creates the project: title, description, total hours budget, who contributes what\n2. Members sign on as contributors with planned hours\n3. Optional 'beneficiary' — the org/person receiving the value\n4. Project runs; coordinator marks completion and confirms each contributor's actual hours\n5. Credits distribute automatically: contributors earn from the beneficiary (or from a community pool if there's no single beneficiary)\n\nThis turns the platform from purely peer-to-peer into a tool for community projects that need coordinated effort. Great for capital projects, festivals, mutual aid responses, and translation/accessibility work.";

    public function up(): void
    {
        if (! Schema::hasTable('ai_module_docs')) {
            return;
        }

        $new = AiModuleDocsService::defaultSeed()['group_exchanges'];

        DB::table('ai_module_docs')
            ->where('module_slug', 'group_exchanges')
            ->where('body', self::OLD_BODY)
            ->update([
                'title' => $new['title'],
                'body' => $new['body'],
                'keywords' => json_encode($new['keywords']),
            ]);
    }

    public function down(): void
    {
        // Deliberately irreversible: restoring text that describes features
        // which do not exist would reintroduce the defect.
    }
};
