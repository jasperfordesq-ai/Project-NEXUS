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
 * Corrects the AI assistant's built-in "Caring Community" grounding text.
 *
 * Each community gets its own copy of the default AI module docs when it is
 * created, so fixing the default in AiModuleDocsService only reaches new
 * communities. The old text described automated check-ins with an
 * "I'm OK / I need help" button, alerts for missed check-ins, a buddy
 * system, an easy-mode layout, a carer listing category and an emergency
 * contact in the menu — none of which exist (owner decision, 26 Oct 2026:
 * the AI help must never describe features that do not exist).
 *
 * Two earlier defaults were shipped; rows still carrying either one exactly
 * are updated. A row an admin has edited is left exactly as it is.
 */
return new class extends Migration
{
    /** The shipped defaults, oldest first. */
    private const OLD_BODIES = [
        "If Caring Community is enabled in your tenant, the platform has extra features designed for communities supporting older adults, carers, people with disabilities, and those at risk of social isolation.\n\nFeatures include:\n• Wellbeing check-ins — regular automated check-in messages with a 'I'm OK / I need help' button. Missed check-ins alert designated buddies or admins.\n• Buddy system — members are paired with a regular check-in partner\n• Easy-mode UI — larger text, simpler navigation, voice-controlled posting\n• Trusted helper network — vetted volunteers with safeguarding training visible by badge\n• Carer support listings — special category for respite, befriending, transport to medical appointments\n• Family/carer view — a family member can have read-only access to their loved one's account with consent\n• Accessible event filtering — wheelchair-accessible, sensory-friendly, easy-language\n• Direct emergency contact in the menu\n\nAll Caring Community features respect dignity, consent, and privacy. Vulnerable adult declarations are private to the member and accessible only to designated safeguarding leads in the community.",
        "If Caring Community is enabled in your tenant, the platform has extra features designed for communities supporting older adults, carers, people with disabilities, and those at risk of social isolation.\n\nFeatures include:\n• Wellbeing check-ins — regular automated check-in messages with a 'I'm OK / I need help' button. Missed check-ins alert designated buddies or admins.\n• Buddy system — members are paired with a regular check-in partner\n• Easy-mode UI — larger text, simpler navigation, voice-controlled posting\n• Trusted helper network — helpers arranged under the community's role-specific safeguarding process, without a public vetting badge\n• Carer support listings — special category for respite, befriending, transport to medical appointments\n• Family/carer view — a family member can have read-only access to their loved one's account with consent\n• Accessible event filtering — wheelchair-accessible, sensory-friendly, easy-language\n• Direct emergency contact in the menu\n\nAll Caring Community features respect dignity, consent, and privacy. Vulnerable adult declarations and safeguarding vetting confirmations are private to the member and authorised safeguarding decision-makers; Project NEXUS does not retain criminal-record certificates.",
    ];

    public function up(): void
    {
        if (! Schema::hasTable('ai_module_docs')) {
            return;
        }

        $new = AiModuleDocsService::defaultSeed()['caring_community'];

        DB::table('ai_module_docs')
            ->where('module_slug', 'caring_community')
            ->whereIn('body', self::OLD_BODIES)
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
