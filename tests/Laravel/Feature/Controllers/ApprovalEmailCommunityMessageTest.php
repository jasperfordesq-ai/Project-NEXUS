<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Http\Controllers\Api\AdminUsersController;
use App\Models\User;
use App\Services\PrerenderContentInvalidator;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use ReflectionMethod;
use Tests\Laravel\Support\CapturedEmailLinks;
use Tests\Laravel\TestCase;

/**
 * A community's own welcome text in the account-approved email.
 *
 * Bridgwater, 2026-10-15: a coordinator asked whether the approval email's text
 * could be tailored. It could not — every word came from fixed translation
 * keys. A community admin can now add one optional passage of plain text
 * (`general.approval_email_message`, at most 1,000 characters), shown after the
 * opening paragraph. Empty means the email is exactly as before.
 *
 * Plain text, not formatting: paragraph() keeps bold, links and styled spans,
 * which would let an admin put a link of their choosing into an email that
 * carries the platform's name. The text is escaped before it reaches the
 * builder, so markup arrives as visible characters.
 */
class ApprovalEmailCommunityMessageTest extends TestCase
{
    use DatabaseTransactions;

    private const KEY = 'general.approval_email_message';

    protected function tearDown(): void
    {
        TenantContext::reset();
        parent::tearDown();
    }

    // ------------------------------------------------------------- helpers

    private function setMessage(?string $message): void
    {
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', self::KEY)->delete();
        if ($message !== null) {
            DB::table('tenant_settings')->insert([
                'tenant_id' => $this->testTenantId,
                'setting_key' => self::KEY,
                'setting_value' => $message,
            ]);
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    private function sendApprovalEmail(): string
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'approved-' . bin2hex(random_bytes(5)) . '@example.test',
            'first_name' => 'Greta',
            'status' => 'active',
            'is_approved' => 1,
            'preferred_language' => 'en',
        ]);
        $row = User::findById((int) $member->id, false);
        $this->assertNotNull($row);

        $captured = CapturedEmailLinks::install();
        $controller = app(AdminUsersController::class);
        $send = new ReflectionMethod($controller, 'sendApprovalWelcomeEmail');
        TenantContext::runForTenant($this->testTenantId, fn () => $send->invoke($controller, $row, 0));

        $this->assertCount(1, $captured->sent, 'the approval email should have been sent once');

        return $captured->sent[0]['body'];
    }

    private function actAsAdmin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )]);
        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')->andReturn(1);
        });
    }

    private function storedMessage(): ?string
    {
        $value = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', self::KEY)
            ->value('setting_value');

        return $value === null ? null : (string) $value;
    }

    // ------------------------------------------------------------- the email

    public function test_the_communitys_own_text_appears_after_the_opening_paragraph(): void
    {
        $this->setMessage('Our next welcome coffee morning is on the first Tuesday of the month.');

        $body = $this->sendApprovalEmail();

        $this->assertStringContainsString('Our next welcome coffee morning is on the first Tuesday of the month.', $body);
        $intro = strpos($body, 'full member of the');
        $custom = strpos($body, 'welcome coffee morning');
        $list = strpos($body, '<strong>listings</strong>');
        $this->assertNotFalse($intro);
        $this->assertNotFalse($list);
        $this->assertGreaterThan($intro, $custom, 'the community text follows the opening paragraph');
        $this->assertLessThan($list, $custom, 'and comes before the "things you can do" list');
    }

    public function test_markup_in_the_communitys_text_is_shown_as_text_never_rendered(): void
    {
        $this->setMessage('<b>Bold</b> <a href="https://evil.example/">click</a> <script>alert(1)</script> & more');

        $body = $this->sendApprovalEmail();

        $this->assertStringNotContainsString('<b>Bold</b>', $body);
        $this->assertStringNotContainsString('href="https://evil.example/"', $body);
        $this->assertStringNotContainsString('<script>', $body);
        $this->assertStringContainsString('&lt;b&gt;Bold&lt;/b&gt;', $body);
        $this->assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt;', $body);
        $this->assertStringContainsString('&amp; more', $body);
        $this->assertStringNotContainsString('&amp;lt;', $body, 'escaped once, not twice');
    }

    public function test_line_breaks_are_kept_and_a_blank_line_starts_a_new_paragraph(): void
    {
        $this->setMessage("First line\nsecond line\n\nNew paragraph");

        $body = $this->sendApprovalEmail();

        $this->assertMatchesRegularExpression('#First line<br\s*/?>\s*second line#', $body);
        $this->assertMatchesRegularExpression('#second line</p>.*<p[^>]*>\s*New paragraph#s', $body);
    }

    public function test_with_no_community_text_the_email_is_unchanged(): void
    {
        $this->setMessage(null);
        $without = $this->sendApprovalEmail();

        $this->setMessage('   ');
        $blank = $this->sendApprovalEmail();

        // Same paragraphs either way: whitespace-only text adds nothing.
        $this->assertSame(substr_count($without, '<p'), substr_count($blank, '<p'));
        $this->assertStringContainsString('full member of the', $without);
        $this->assertStringContainsString('<strong>listings</strong>', $without);
    }

    // ------------------------------------------------------------- the setting

    public function test_a_community_admin_can_save_and_read_back_the_text(): void
    {
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings', ['approval_email_message' => "  Hello from Bridgwater!\r\nSee you soon.  "])
            ->assertStatus(200);

        $this->assertSame("Hello from Bridgwater!\nSee you soon.", $this->storedMessage());
        $this->apiGet('/v2/admin/settings')
            ->assertOk()
            ->assertJsonPath('data.settings.approval_email_message', "Hello from Bridgwater!\nSee you soon.");
    }

    public function test_clearing_the_text_saves_an_empty_value(): void
    {
        $this->setMessage('Old text');
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings', ['approval_email_message' => ''])->assertStatus(200);

        $this->assertSame('', $this->storedMessage());
    }

    public function test_text_longer_than_1000_characters_is_refused(): void
    {
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings', ['approval_email_message' => str_repeat('é', 1001)])
            ->assertStatus(422);
        $this->assertNull($this->storedMessage());

        // Exactly 1,000 characters (multi-byte) is fine.
        $this->apiPut('/v2/admin/settings', ['approval_email_message' => str_repeat('é', 1000)])
            ->assertStatus(200);
    }

    public function test_a_non_text_value_is_refused(): void
    {
        $this->actAsAdmin();

        $this->apiPut('/v2/admin/settings', ['approval_email_message' => ['not', 'text']])
            ->assertStatus(422);
        $this->assertNull($this->storedMessage());
    }

    public function test_an_ordinary_member_cannot_change_the_text(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiPut('/v2/admin/settings', ['approval_email_message' => 'Sneaky'])->assertStatus(403);
        $this->assertNull($this->storedMessage());
    }
}
