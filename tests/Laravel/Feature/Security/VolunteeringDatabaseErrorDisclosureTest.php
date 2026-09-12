<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use App\Services\VolunteerDonationService;
use App\Services\VolunteerExpenseService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-005 (12 September 2026), F-016.
 *
 * Both volunteering write controllers turn every \RuntimeException into a
 * client-facing answer that echoes $e->getMessage(). Illuminate's
 * QueryException IS a RuntimeException (via PDOException), and both services
 * rethrow it when the request carries no idempotency key or the stored request
 * hash does not match — so a database failure answered 400 with the full SQL
 * statement, its bindings and the connection name in the response body.
 *
 * A database failure is a server error. Its text never belongs to the client.
 * The services are replaced with subclasses that throw the exception the
 * database would, so the test is deterministic and needs no real constraint
 * violation.
 */
class VolunteeringDatabaseErrorDisclosureTest extends TestCase
{
    use DatabaseTransactions;

    public const SENTINEL_BINDING = 'sentinel-binding-9f3a1c';

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public static function databaseFailure(string $table): QueryException
    {
        return new QueryException(
            'mysql',
            "insert into `{$table}` (`tenant_id`, `payment_reference`) values (?, ?)",
            [2, self::SENTINEL_BINDING],
            new \PDOException('SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry'),
        );
    }

    public function test_a_database_failure_while_recording_a_donation_is_a_generic_server_error(): void
    {
        $this->app->instance(VolunteerDonationService::class, new class extends VolunteerDonationService {
            public static function createDonation(int $userId, array $data): array
            {
                throw VolunteeringDatabaseErrorDisclosureTest::databaseFailure('vol_donations');
            }
        });
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/volunteering/donations', [
            'amount' => 25,
            'payment_method' => 'bank_transfer',
        ]);

        $this->assertNoDatabaseTextReachesTheClient($response, 'vol_donations');
    }

    public function test_a_database_failure_while_submitting_an_expense_is_a_generic_server_error(): void
    {
        $this->app->instance(VolunteerExpenseService::class, new class extends VolunteerExpenseService {
            public static function submitExpense(int $userId, array $data): array
            {
                throw VolunteeringDatabaseErrorDisclosureTest::databaseFailure('vol_expenses');
            }
        });
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/volunteering/expenses', [
            'organization_id' => 1,
            'expense_type' => 'travel',
            'amount' => 12.5,
            'description' => 'Bus fare to the shift',
        ]);

        $this->assertNoDatabaseTextReachesTheClient($response, 'vol_expenses');
    }

    private function assertNoDatabaseTextReachesTheClient(TestResponse $response, string $table): void
    {
        $response->assertStatus(500);
        $response->assertJsonPath('errors.0.code', 'SERVER_ERROR');

        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('insert into', $body, 'the SQL statement reached the client');
        $this->assertStringNotContainsString($table, $body, 'the table name reached the client');
        $this->assertStringNotContainsString(self::SENTINEL_BINDING, $body, 'a query binding reached the client');
        $this->assertStringNotContainsString('SQLSTATE', $body, 'the driver error reached the client');
    }
}
