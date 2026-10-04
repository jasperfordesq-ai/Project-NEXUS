<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E089;

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-565 (E-089): the member statement CSV (GET /v2/wallet/statement, also
 * proxied by the accessible frontend's wallet export) neutralised formulas
 * with its own private rule, which only looked at the very first character.
 * The shared CsvExportSanitizer also covers a trigger hidden behind leading
 * whitespace or control characters. The statement now uses the shared rule,
 * so every CSV the platform writes neutralises the same way.
 */
final class F565PersonalStatementCsvSanitiserTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array<int, array{0: string}> */
    public static function hiddenFormulas(): array
    {
        return [
            ["=cmd|'/C calc'!A0"],
            [" =1+1"],
            ["\t\t=HYPERLINK(\"http://x\",\"y\")"],
            ["\x01+1+1"],
            ["\n@SUM(1)"],
        ];
    }

    /** @dataProvider hiddenFormulas */
    public function test_statement_neutralises_formula_wherever_the_trigger_hides(string $description): void
    {
        $tenantId = $this->testTenantId;
        $sender = User::factory()->forTenant($tenantId)->create();
        $receiver = User::factory()->forTenant($tenantId)->create();
        Transaction::factory()->forTenant($tenantId)->create([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'status' => 'completed',
            'description' => $description,
        ]);

        Sanctum::actingAs($receiver);
        $response = $this->get('/api/v2/wallet/statement', $this->withTenantHeader([]));
        $response->assertOk();

        // Under APP_ENV=testing sendCSVDownload() throws an HttpException(200)
        // carrying the CSV as its message instead of echo+exit, and Laravel
        // renders that as JSON — so the CSV arrives JSON-encoded here.
        $body = $response->getContent();
        $decoded = json_decode($body, true);
        $csv = is_array($decoded) && isset($decoded['message']) ? (string) $decoded['message'] : $body;

        // Quotes are collapsed on both sides: the CSV wraps and doubles them.
        $this->assertStringContainsString(str_replace('"', '', "'" . $description), $this->unquote($csv), 'formula must be prefixed with an apostrophe');
    }

    /** Collapse CSV quoting so the raw cell text can be asserted on. */
    private function unquote(string $csv): string
    {
        return str_replace(['""', '"'], ['"', ''], $csv);
    }
}
