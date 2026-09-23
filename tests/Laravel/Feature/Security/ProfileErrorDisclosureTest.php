<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-039 (E-024): a failed profile write must not hand the database error to
 * the member.
 *
 * UserService put `$e->getMessage()` straight into the API response, so a
 * write the database rejected returned `SQLSTATE[...] (Connection: mysql,
 * Host: db, Port: 3306, Database: ..., SQL: update `users` set ...)` - the
 * database host, port and name, the table and index names and the statement.
 */
class ProfileErrorDisclosureTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function assertNoInternals(string $body): void
    {
        foreach (['SQLSTATE', 'Connection:', 'Host:', 'Port:', 'Database:', 'SQL:', 'update `users`'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, "response leaked '{$needle}': {$body}");
        }
    }

    public function test_a_profile_write_the_database_rejects_returns_a_plain_message(): void
    {
        $this->member();

        // The connection runs non-strict, so ordinary input rarely makes the
        // database refuse a write; simulate the refusal E-024 reproduced (a
        // duplicate key) exactly as Laravel raises it.
        User::saving(function (): void {
            throw new QueryException(
                'mysql',
                'update `users` set `bio` = ? where `id` = ?',
                ['x', 1],
                new \PDOException("SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'a-2' for key 'unique_email_tenant' (Connection: mysql, Host: db, Port: 3306, Database: nexus_test)"),
            );
        });

        $response = $this->apiPut('/v2/users/me', ['bio' => 'anything']);

        $response->assertStatus(422);
        $this->assertSame('UPDATE_FAILED', $response->json('errors.0.code'));
        $this->assertSame(__('api.generic_error'), $response->json('errors.0.message'));
        $this->assertNoInternals($response->getContent());
    }

    public function test_an_avatar_validation_message_still_reaches_the_member(): void
    {
        $this->member();

        $response = $this->post('/api/v2/users/me/avatar', [
            'avatar' => UploadedFile::fake()->createWithContent('notes.txt', 'plain text, not an image'),
        ], ['X-Tenant-ID' => (string) $this->testTenantId, 'Accept' => 'application/json']);

        $response->assertStatus(400);
        $this->assertSame('UPLOAD_FAILED', $response->json('errors.0.code'));
        $this->assertStringStartsWith('Invalid file', (string) $response->json('errors.0.message'));
        $this->assertNoInternals($response->getContent());
    }
}
