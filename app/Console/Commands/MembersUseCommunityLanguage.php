<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\CommunityLanguage;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Moves one community's members who were saved as English only because nobody
 * asked them — the `users.preferred_language` column default — to the
 * community's own language.
 *
 * Only members who have NEVER signed in are moved: they cannot have chosen a
 * language. A member who has signed in has been using the site in the language
 * they saw and may have picked it with the language menu, which leaves no
 * record, so they are left alone. Dry run unless --apply is given.
 */
final class MembersUseCommunityLanguage extends Command
{
    protected $signature = 'members:use-community-language
        {tenant : The community, by id or slug}
        {--apply : Make the change (without it, only report what would change)}';

    protected $description = "Give a community's never-signed-in members, saved as English by default, the community's own language.";

    public function handle(): int
    {
        $ref = trim((string) $this->argument('tenant'));
        $tenant = DB::table('tenants')
            ->where(ctype_digit($ref) ? 'id' : 'slug', ctype_digit($ref) ? (int) $ref : $ref)
            ->first(['id', 'slug']);
        if ($tenant === null) {
            $this->error("No community '{$ref}'.");
            return self::INVALID;
        }

        $tenantId = (int) $tenant->id;
        $language = CommunityLanguage::forTenant($tenantId);
        if ($language === 'en') {
            $this->line("tenant={$tenant->slug} language=en candidates=0 changed=0 (community language is English)");
            return self::SUCCESS;
        }

        $candidates = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('preferred_language', 'en')
            ->whereNull('last_login_at')
            ->where(static fn ($q) => $q->whereNull('status')->orWhere('status', '!=', 'delegate'));

        $count = (clone $candidates)->count();
        $changed = $this->option('apply') ? $candidates->update(['preferred_language' => $language]) : 0;

        $this->line(sprintf(
            'tenant=%s language=%s candidates=%d changed=%d%s',
            $tenant->slug,
            $language,
            $count,
            $changed,
            $this->option('apply') ? '' : ' (dry run: add --apply to change)'
        ));

        return self::SUCCESS;
    }
}
