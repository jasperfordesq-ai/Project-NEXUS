<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-319 (E-062) — User::createWithTenant(), the helper every administrator-side
 * account-creation path uses, wrote no users.status (so the column default
 * 'active' applied) and defaulted is_approved to 1. A caller that forgot to
 * say otherwise created a live, approved account. Admission must now be
 * stated by the caller; saying nothing yields a pending, unapproved account.
 */
class F319CreateWithTenantAdmissionDefaultTest extends TestCase
{
    use DatabaseTransactions;

    /** @param array<string,mixed> $extra */
    private function create(array $extra = []): int
    {
        $id = User::createWithTenant(array_merge([
            'first_name' => 'F319',
            'last_name' => 'Helper',
            'email' => 'f319-' . bin2hex(random_bytes(6)) . '@example.invalid',
            'password' => 'Str0ng-F319-passphrase!',
        ], $extra), $this->testTenantId);

        $this->assertNotNull($id, 'precondition: createWithTenant created a row');

        return (int) $id;
    }

    /** @return array{status:string,is_approved:int} */
    private function admission(int $id): array
    {
        $row = DB::table('users')->where('id', $id)->where('tenant_id', $this->testTenantId)->first(['status', 'is_approved']);

        return ['status' => (string) $row->status, 'is_approved' => (int) $row->is_approved];
    }

    public function test_a_caller_that_states_nothing_gets_a_pending_unapproved_account(): void
    {
        $this->assertSame(
            ['status' => 'pending', 'is_approved' => 0],
            $this->admission($this->create()),
            'an account nobody admitted must not be active or approved'
        );
    }

    public function test_control_an_explicitly_approved_account_is_active(): void
    {
        $this->assertSame(
            ['status' => 'active', 'is_approved' => 1],
            $this->admission($this->create(['is_approved' => 1]))
        );
    }

    public function test_an_explicit_status_is_written_and_an_unknown_one_fails_closed(): void
    {
        $this->assertSame(
            ['status' => 'pending', 'is_approved' => 1],
            $this->admission($this->create(['is_approved' => 1, 'status' => 'pending'])),
            'an approved account held for another check keeps the status it was given'
        );
        $this->assertSame(
            'pending',
            $this->admission($this->create(['is_approved' => 1, 'status' => 'banana']))['status'],
            'a status outside active/pending must not be written'
        );
    }
}
