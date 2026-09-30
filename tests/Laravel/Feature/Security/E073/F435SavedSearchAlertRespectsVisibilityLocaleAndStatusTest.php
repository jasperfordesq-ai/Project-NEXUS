<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\I18n\LocaleContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * F-435 (E-073 B-3) — the hourly saved-search alert.
 *
 * `ProcessSavedSearchAlerts::processSingleSearch()` built its own listing query
 * that applied only `status IS NULL OR status = 'active'`. The canonical read
 * rule, `ListingService::applyPublicVisibility()`, also requires
 * `moderation_status IS NULL OR moderation_status = 'approved'`, and a
 * GDPR-erased listing additionally carries `deleted_at`. The alert therefore
 * counted listings the platform has decided the member may not see, and stored
 * that inflated number in `saved_searches.last_result_count`.
 *
 * The same method built its message by string concatenation in English, with no
 * translation key and no `LocaleContext::withLocale()` wrap, so every member
 * received it in English whatever their `preferred_language` — against both
 * binding rules in AGENTS.md. And it never checked the recipient's own account
 * status, so a suspended, banned or soft-deleted member still received the bell
 * notification and the push.
 *
 * These tests assert the CORRECT behaviour.
 *
 * Control: an active member with one genuinely visible new listing still
 * receives exactly one correct alert — the feature still works.
 */
final class F435SavedSearchAlertRespectsVisibilityLocaleAndStatusTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
    }

    /**
     * CONTROL — the feature still works: an active member with one visible new
     * listing gets exactly one alert, and it counts exactly one listing.
     */
    public function test_control_an_active_member_with_a_visible_match_still_gets_the_alert(): void
    {
        [$owner, $watcher] = $this->pair();
        $term = 'f435control' . uniqid();
        $searchId = $this->savedSearch((int) $watcher->id, $term);
        $this->listing((int) $owner->id, $term . ' approved', 'active', 'approved');

        Artisan::call('listings:process-search-alerts', ['--tenant' => $this->testTenantId]);

        $this->assertSame(
            $this->expectedMessage('en', 1, $term),
            $this->alertMessage((int) $watcher->id),
            'control: the visible listing produced exactly one alert, counting 1'
        );
        $this->assertSame(1, $this->storedCount($searchId), 'control: last_result_count is 1');
    }

    /**
     * THE HARM — moderator-rejected, still-awaiting-review and soft-deleted
     * listings must not be counted, and the stored figure must match.
     */
    public function test_the_count_matches_the_canonical_visibility_rule(): void
    {
        [$owner, $watcher] = $this->pair();
        $term = 'f435harm' . uniqid();
        $searchId = $this->savedSearch((int) $watcher->id, $term);

        $this->listing((int) $owner->id, $term . ' approved', 'active', 'approved');
        $this->listing((int) $owner->id, $term . ' rejected', 'active', 'rejected');
        $this->listing((int) $owner->id, $term . ' pending', 'active', 'pending_review');
        $deleted = $this->listing((int) $owner->id, $term . ' deleted', 'active', 'approved');
        DB::table('listings')->where('id', $deleted)->update(['deleted_at' => now()]);

        // What every other listing read on the platform shows the member.
        $visible = DB::table('listings')
            ->where('tenant_id', $this->testTenantId)
            ->whereNull('deleted_at')
            ->where('title', 'like', $term . '%')
            ->where(function ($q): void {
                $q->whereNull('status')->orWhere('status', 'active');
            })
            ->where(function ($q): void {
                $q->whereNull('moderation_status')->orWhere('moderation_status', 'approved');
            })
            ->count();
        $this->assertSame(1, $visible, 'precondition: only one of the four is publicly visible');

        Artisan::call('listings:process-search-alerts', ['--tenant' => $this->testTenantId]);

        $this->assertSame(
            $this->expectedMessage('en', 1, $term),
            $this->alertMessage((int) $watcher->id),
            'the alert must count only the listing the member may actually see'
        );
        $this->assertSame(
            1,
            $this->storedCount($searchId),
            'saved_searches.last_result_count must match the canonical visibility rule too'
        );
    }

    /** The alert must render in the recipient's language, not the worker's default. */
    public function test_the_alert_renders_in_the_recipients_language(): void
    {
        [$owner, $watcher] = $this->pair(['preferred_language' => 'fr']);
        $term = 'f435locale' . uniqid();
        $this->savedSearch((int) $watcher->id, $term);
        $this->listing((int) $owner->id, $term . ' approved', 'active', 'approved');

        $french = $this->expectedMessage('fr', 1, $term);
        $english = $this->expectedMessage('en', 1, $term);
        $this->assertNotSame(
            $english,
            $french,
            'precondition: lang/fr/notifications.php carries a real translation of this key'
        );

        Artisan::call('listings:process-search-alerts', ['--tenant' => $this->testTenantId]);

        $this->assertSame(
            $french,
            $this->alertMessage((int) $watcher->id),
            'the alert must render in the recipient preferred_language'
        );
    }

    /** A member the community has suspended must not be notified. */
    public function test_a_suspended_member_is_not_notified(): void
    {
        [$owner, $watcher] = $this->pair(['status' => 'suspended']);
        $term = 'f435suspended' . uniqid();
        $searchId = $this->savedSearch((int) $watcher->id, $term);
        $this->listing((int) $owner->id, $term . ' approved', 'active', 'approved');
        $stampBefore = DB::table('saved_searches')->where('id', $searchId)->value('last_notified_at');

        Artisan::call('listings:process-search-alerts', ['--tenant' => $this->testTenantId]);

        $this->assertSame(
            0,
            DB::table('notifications')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $watcher->id)
                ->where('type', 'saved_search_alert')
                ->count(),
            'a suspended member must not receive the saved-search alert'
        );
        $this->assertSame(
            $stampBefore,
            DB::table('saved_searches')->where('id', $searchId)->value('last_notified_at'),
            'nothing was sent, so nothing should be stamped'
        );
        $this->assertNull(
            DB::table('saved_searches')->where('id', $searchId)->value('last_result_count'),
            'nothing was sent, so no result count should be stored'
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * @param  array<string, mixed>  $watcherOverrides
     * @return array{User, User}
     */
    private function pair(array $watcherOverrides = []): array
    {
        return [
            User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']),
            User::factory()->forTenant($this->testTenantId)->create(
                array_merge(['status' => 'active'], $watcherOverrides)
            ),
        ];
    }

    private function savedSearch(int $userId, string $term): int
    {
        return (int) DB::table('saved_searches')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'name' => 'F435 ' . $term,
            'query_params' => json_encode(['q' => $term]),
            'notify_on_new' => 1,
            'last_notified_at' => now()->subDay(),
            'created_at' => now()->subDays(2),
            'updated_at' => now()->subDays(2),
        ]);
    }

    private function listing(int $ownerId, string $title, string $status, ?string $moderation): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => $title,
            'description' => 'F435 fixture',
            'type' => 'offer',
            'status' => $status,
            'moderation_status' => $moderation,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function alertMessage(int $userId): string
    {
        $row = DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('type', 'saved_search_alert')
            ->orderByDesc('id')
            ->first(['message']);
        $this->assertNotNull($row, 'a saved-search alert notification was created');

        return (string) $row->message;
    }

    private function storedCount(int $searchId): int
    {
        return (int) DB::table('saved_searches')->where('id', $searchId)->value('last_result_count');
    }

    private function expectedMessage(string $locale, int $count, string $term): string
    {
        $name = htmlspecialchars('F435 ' . $term, ENT_QUOTES, 'UTF-8');

        return LocaleContext::withLocale($locale, fn (): string => $count === 1
            ? __('notifications.saved_search_alert_one', ['search' => $name])
            : __('notifications.saved_search_alert_many', ['count' => $count, 'search' => $name]));
    }
}
