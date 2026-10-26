<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Models\UserSafeguardingPreference;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A note a member writes with a safeguarding choice is stored encrypted
 * (gap found 26 Oct 2026). Notes saved before this change, in plain text,
 * still read back.
 */
class SafeguardingNotesEncryptionTest extends TestCase
{
    use DatabaseTransactions;

    public function test_a_note_is_stored_encrypted_and_reads_back(): void
    {
        [$member, $option] = $this->memberAndOption();

        $preference = UserSafeguardingPreference::create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $option->id,
            'selected_value' => '1',
            'notes' => 'I find phone calls hard',
            'consent_given_at' => now(),
        ]);

        $raw = (string) DB::table('user_safeguarding_preferences')->where('id', $preference->id)->value('notes');
        $this->assertNotSame('', $raw);
        $this->assertStringNotContainsString('phone calls', $raw);
        $this->assertSame('I find phone calls hard', UserSafeguardingPreference::query()->find($preference->id)?->notes);
        $this->assertSame('I find phone calls hard', UserSafeguardingPreference::decryptNotes($raw));
    }

    public function test_a_note_saved_before_encryption_still_reads_back(): void
    {
        [$member, $option] = $this->memberAndOption();
        $id = (int) DB::table('user_safeguarding_preferences')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $option->id,
            'selected_value' => '1',
            'notes' => 'Older plain note',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        $this->assertSame('Older plain note', UserSafeguardingPreference::query()->find($id)?->notes);
        $this->assertSame('Older plain note', UserSafeguardingPreference::decryptNotes('Older plain note'));
        $this->assertNull(UserSafeguardingPreference::decryptNotes(null));
    }

    /** @return array{0: User, 1: TenantSafeguardingOption} */
    private function memberAndOption(): array
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $option = TenantSafeguardingOption::create([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'notes_test_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Notes test option',
            'sort_order' => 1,
            'is_active' => true,
            'triggers' => [],
        ]);

        return [$member, $option];
    }
}
