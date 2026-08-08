<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Gdpr;

use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Runs the REAL Article 17 erasure against the REAL schema.
 *
 * 🔴 Why this class exists, and why it is not another source-grep test.
 *
 * GdprService::executeAccountDeletion() is ~1,100 lines of hand-written SQL
 * across a hundred-odd tables. The existing coverage
 * ({@see \Tests\Laravel\Unit\Services\GdprServiceTest}) asserts against a mocked
 * PDO and greps the source for expected SQL strings. Neither can see the schema,
 * so neither can catch the failure mode this codebase has already shipped twice:
 * an UPDATE naming a column that does not exist. In 2026-07 the 2FA and
 * exchange-notes steps did exactly that — the encrypted TOTP secret and exchange
 * free-text survived erasure, and the swallowing try/catch hid it.
 *
 * Executing the method for real closes that gap. Most steps are bare
 * `$this->query(...)` calls, so a drifted table or column throws, the outer
 * `catch (\Exception)` rethrows, and this test fails loudly with the offending
 * SQL. A green run here means every unguarded erasure statement is valid against
 * the committed schema — which no amount of string matching can establish.
 */
class AccountErasureExecutionTest extends TestCase
{
    use DatabaseTransactions;

    /** The erased user's words, as the service replaces them. */
    private const REDACTED_BODY = '[message removed — account erased]';

    private ?string $originalStoragePath = null;
    private ?string $exportRoot = null;

    protected function setUp(): void
    {
        parent::setUp();

        // Step 1 of the erasure writes a retention export (zip + temp tree) to
        // getenv('STORAGE_PATH') ?: <repo>/storage. Redirect it at a throwaway
        // directory so a test run never leaves artefacts in the working tree.
        $this->originalStoragePath = getenv('STORAGE_PATH') ?: null;
        $this->exportRoot = rtrim(sys_get_temp_dir(), '/\\') . '/nexus-gdpr-erasure-test-' . getmypid();
        putenv('STORAGE_PATH=' . $this->exportRoot);
    }

    protected function tearDown(): void
    {
        if ($this->exportRoot !== null && is_dir($this->exportRoot)) {
            $this->removeDirectory($this->exportRoot);
        }
        if ($this->originalStoragePath === null) {
            putenv('STORAGE_PATH');
        } else {
            putenv('STORAGE_PATH=' . $this->originalStoragePath);
        }

        parent::tearDown();
    }

    private function removeDirectory(string $dir): void
    {
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($items as $item) {
            $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($dir);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status'      => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    // ── The schema check ─────────────────────────────────────────────────────

    /**
     * 🔴 The headline test: a full erasure runs to completion against the real
     * schema without throwing. If any unguarded erasure statement names a table
     * or column that no longer exists, this fails with that statement's error —
     * which is exactly how the 2026-07 TOTP/exchange drift should have been
     * caught, and never was.
     */
    public function test_a_full_erasure_completes_without_throwing(): void
    {
        $member = $this->member();

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);

        $this->assertNotNull(
            DB::table('users')->where('id', $member->id)->first(),
            'erasure anonymises the users row; it must not delete it'
        );
    }

    /**
     * The identity fields the erasure promises to remove. Asserted on the stored
     * row, not on the SQL — a statement can be present and still not have run.
     */
    public function test_erasure_strips_every_identifying_field_from_the_user_row(): void
    {
        $member = $this->member([
            'first_name' => 'Ida',
            'last_name'  => 'Identifiable',
            'phone'      => '+353861234567',
            'bio'        => 'I live at 12 Real Street and my dog is called Rex.',
            'location'   => 'Galway',
        ]);
        $originalEmail = (string) $member->email;

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);

        $row = DB::table('users')->where('id', $member->id)->first();
        $this->assertNotNull($row);

        $this->assertSame('Deleted', $row->first_name);
        $this->assertSame('User', $row->last_name);
        $this->assertNull($row->phone);
        $this->assertNull($row->bio);
        $this->assertNull($row->location);
        $this->assertNull($row->avatar_url);
        $this->assertSame('inactive', $row->status);
        $this->assertNotNull($row->deleted_at, 'deleted_at must be stamped');
        $this->assertNotNull($row->anonymized_at, 'anonymized_at must be stamped');

        // The email is replaced with a per-user unique address. A SHARED
        // placeholder would collide on the unique index and silently abort the
        // anonymisation of the second erased member.
        $this->assertNotSame($originalEmail, $row->email);
        $this->assertStringContainsString('@anonymized.local', (string) $row->email);
        $this->assertStringContainsString("deleted_{$member->id}_", (string) $row->email);

        // Credentials must not survive: an erased account must not be loginable.
        $this->assertSame('', (string) $row->password_hash);
        $this->assertNull($row->remember_token);
    }

    /**
     * Two erasures in the same tenant must not collide. This is the regression
     * guard for the shared-placeholder-email bug: `deleted@anonymized.local` for
     * everyone means the second UPDATE hits the unique index and throws, so the
     * second member's PII survives.
     */
    public function test_two_erasures_do_not_collide_on_the_anonymised_email(): void
    {
        $first  = $this->member();
        $second = $this->member();

        $service = new GdprService($this->testTenantId);
        $service->executeAccountDeletion((int) $first->id);
        $service->executeAccountDeletion((int) $second->id);

        $emails = DB::table('users')
            ->whereIn('id', [$first->id, $second->id])
            ->pluck('email')
            ->all();

        $this->assertCount(2, $emails);
        $this->assertNotSame(
            $emails[0],
            $emails[1],
            'each erased account needs its own anonymised address'
        );
    }

    // ── Cross-tenant safety ──────────────────────────────────────────────────

    /**
     * 🔴 A tenant admin must not be able to erase a member of another community.
     * The service takes a bare user id, so this `FOR UPDATE` tenant check is the
     * only thing standing between an id typo and destroying someone else's
     * account.
     */
    public function test_erasure_refuses_a_member_of_another_tenant(): void
    {
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name'       => 'Other Community',
            'slug'       => 'erasure-other-' . substr(md5(uniqid('', true)), 0, 8),
            'parent_id'  => $this->testTenantId,
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $outsider = User::factory()->forTenant($otherTenantId)->create([
            'first_name' => 'Olive',
            'status'     => 'active',
        ]);

        try {
            (new GdprService($this->testTenantId))->executeAccountDeletion((int) $outsider->id);
            $this->fail('erasing a member of another tenant must throw');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('unknown tenant user', $e->getMessage());
        }

        $row = DB::table('users')->where('id', $outsider->id)->first();
        $this->assertSame('Olive', $row->first_name, "the other tenant's member is untouched");
        $this->assertNull($row->anonymized_at);
    }

    // ── Two-party data: the counterparty keeps their side ────────────────────

    /**
     * Messages are deliberately NOT hard-deleted. Erasing them would leave the
     * counterparty with half a conversation and no record of what they were
     * told. So: the erased member's own words are replaced, and the words they
     * RECEIVED stay readable.
     */
    public function test_erasure_redacts_what_the_member_wrote_but_keeps_what_they_received(): void
    {
        $member       = $this->member();
        $counterparty = $this->member();

        $sentId = DB::table('messages')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'sender_id'   => $member->id,
            'receiver_id' => $counterparty->id,
            'subject'     => 'About your listing',
            'body'        => 'You can reach me on 086 123 4567, I live near the church.',
            'created_at'  => now(),
        ]);
        $receivedId = DB::table('messages')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'sender_id'   => $counterparty->id,
            'receiver_id' => $member->id,
            'subject'     => 'Re: About your listing',
            'body'        => 'Great, see you Tuesday at ten.',
            'created_at'  => now(),
        ]);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);

        $sent = DB::table('messages')->where('id', $sentId)->first();
        $this->assertNotNull($sent, 'the row stays so the thread is not orphaned');
        $this->assertSame(self::REDACTED_BODY, $sent->body);
        $this->assertStringNotContainsString('086 123 4567', (string) $sent->body);

        $received = DB::table('messages')->where('id', $receivedId)->first();
        $this->assertNotNull($received);
        $this->assertSame(
            'Great, see you Tuesday at ten.',
            $received->body,
            "the counterparty's own words must survive the other party's erasure"
        );
    }

    /**
     * Messages between two OTHER members must not be touched at all. The
     * anonymisation UPDATE is scoped `WHERE (sender_id = ? OR receiver_id = ?)`;
     * losing that scope would redact the whole tenant's inbox.
     */
    public function test_erasure_does_not_touch_conversations_it_is_not_part_of(): void
    {
        $member    = $this->member();
        $bystander = $this->member();
        $friend    = $this->member();

        $untouchedId = DB::table('messages')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'sender_id'   => $bystander->id,
            'receiver_id' => $friend->id,
            'body'        => 'Nothing to do with the erased member.',
            'created_at'  => now(),
        ]);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);

        $this->assertSame(
            'Nothing to do with the erased member.',
            DB::table('messages')->where('id', $untouchedId)->value('body')
        );
    }

    // ── Consent records ──────────────────────────────────────────────────────

    /**
     * Consent rows are the member's own record and are hard-deleted. Another
     * member's consents in the same tenant must survive — the DELETE is scoped by
     * user_id AND tenant_id.
     */
    public function test_erasure_deletes_the_members_consents_and_only_theirs(): void
    {
        $member    = $this->member();
        $bystander = $this->member();

        foreach ([$member->id, $bystander->id] as $userId) {
            DB::table('user_consents')->insert([
                'user_id'         => $userId,
                'tenant_id'       => $this->testTenantId,
                'consent_type'    => 'erasure-test-marketing',
                'consent_given'   => 1,
                'consent_text'    => 'Marketing consent text',
                'consent_version' => '1.0',
                'given_at'        => now(),
                'created_at'      => now(),
            ]);
        }

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);

        $this->assertSame(
            0,
            DB::table('user_consents')->where('user_id', $member->id)->count(),
            "the erased member's consent records must be deleted"
        );
        $this->assertSame(
            1,
            DB::table('user_consents')->where('user_id', $bystander->id)->count(),
            "another member's consent records must survive"
        );
    }

    // ── Request lifecycle ────────────────────────────────────────────────────

    /**
     * When the erasure is driven by a data-rights request, that request must end
     * up 'completed' with the acting admin recorded — otherwise the tenant's
     * 30-day GDPR clock keeps running on work that is already done, and the
     * overdue-request alert fires forever.
     */
    public function test_a_clean_erasure_completes_the_linked_request(): void
    {
        $member = $this->member();
        $admin  = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);

        $requestId = (int) DB::table('gdpr_requests')->insertGetId([
            'user_id'      => $member->id,
            'tenant_id'    => $this->testTenantId,
            'request_type' => 'erasure',
            'status'       => 'processing',
            'requested_at' => now(),
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        (new GdprService($this->testTenantId))
            ->executeAccountDeletion((int) $member->id, (int) $admin->id, $requestId);

        $request = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('completed', $request->status);
        $this->assertNotNull($request->processed_at);
        $this->assertSame((int) $admin->id, (int) $request->processed_by);
    }

    /**
     * The erasure writes its own audit trail. A deletion with no record of who
     * ran it, and when, is not an auditable Article 17 response.
     */
    public function test_erasure_records_an_audit_action(): void
    {
        $member = $this->member();

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);

        $this->assertSame(
            1,
            DB::table('gdpr_audit_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $member->id)
                ->where('action', 'account_deleted')
                ->count(),
            'erasure must leave exactly one account_deleted audit entry'
        );
    }
}
