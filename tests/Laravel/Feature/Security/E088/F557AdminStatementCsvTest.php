<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-557 (E-088): the admin per-member statement CSV was built by string
 * concatenation with no formula neutralising, wrapped in a JSON envelope
 * (so the saved .csv was JSON text), and its "Balance After" column repeated
 * the current balance on every row.
 */
final class F557AdminStatementCsvTest extends TestCase
{
    use DatabaseTransactions;

    public function test_statement_csv_is_a_real_csv_attachment(): void
    {
        [$admin, $member] = $this->fixture('Garden help');
        Sanctum::actingAs($admin);

        $response = $this->get('/api/v2/admin/timebanking/user-statement?user_id=' . $member->id . '&format=csv', $this->withTenantHeader([]));

        $response->assertOk();
        $this->assertStringStartsWith('text/csv', (string) $response->headers->get('Content-Type'));
        $this->assertStringStartsWith('attachment;', (string) $response->headers->get('Content-Disposition'));

        $rows = $this->rows($response->getContent());
        $this->assertSame(['Date', 'Type', 'Description', 'Amount', 'Status'], $rows[0]);
        $this->assertSame('Earned', $rows[1][1]);
        $this->assertSame('Garden help', $rows[1][2]);
        $this->assertSame('1.5', $rows[1][3]);
        $this->assertSame('completed', $rows[1][4]);
    }

    public function test_statement_csv_neutralises_formula_descriptions(): void
    {
        foreach (['=HYPERLINK("http://x","y")', '+1+1', '-1+1', '@SUM(1)'] as $formula) {
            [$admin, $member] = $this->fixture($formula);
            Sanctum::actingAs($admin);

            $response = $this->get('/api/v2/admin/timebanking/user-statement?user_id=' . $member->id . '&format=csv', $this->withTenantHeader([]));

            $response->assertOk();
            $this->assertSame("'" . $formula, $this->rows($response->getContent())[1][2], $formula);
        }
    }

    /** @return array{0: User, 1: User} */
    private function fixture(string $description): array
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $other->id,
            'receiver_id' => $member->id,
            'amount' => 1.5,
            'description' => $description,
            'status' => 'completed',
            'created_at' => now(),
        ]);

        return [$admin, $member];
    }

    /** @return list<list<string|null>> */
    private function rows(string|false $csv): array
    {
        $csv = (string) $csv;
        $csv = str_starts_with($csv, "\xEF\xBB\xBF") ? substr($csv, 3) : $csv;
        $lines = preg_split('/\r?\n/', trim($csv)) ?: [];

        return array_map(static fn (string $line): array => str_getcsv($line), $lines);
    }
}
