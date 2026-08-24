<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Core;

use App\Core\Mailer;
use Tests\Laravel\TestCase;

/**
 * 🔴 These emails go out SYNCHRONOUSLY inside member-facing write requests.
 *
 * `App\Core\Mailer` is a hand-rolled SMTP client — it does NOT use Laravel's
 * mail layer, so `MAIL_MAILER=array` does not disable it. It opened the socket
 * with a 30-second connect timeout and then read replies with NO stream timeout
 * at all, inheriting php.ini's `default_socket_timeout` (60s here) on each of
 * the several reads a send performs.
 *
 * Measured on 2026-08-24: with the mail host unreachable, creating a listing
 * took 9.6s, the accessible frontend gave up at its 15s budget, and the member
 * was shown a failure for a listing that HAD been created.
 *
 * The dangerous case is not a refused connection (that fails fast) but a host
 * that ACCEPTS the connection and then goes quiet. This test creates exactly
 * that: a real listening socket that accepts and never speaks.
 */
class MailerSocketTimeoutTest extends TestCase
{
    /** @var resource|null */
    private $server = null;

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            fclose($this->server);
        }
        parent::tearDown();
    }

    /**
     * Bind a socket that accepts connections and sends nothing back, which is
     * how a wedged mail relay behaves.
     *
     * @return array{host: string, port: int}
     */
    private function silentServer(): array
    {
        $this->server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        $this->assertIsResource($this->server, "could not bind a test socket: $errstr ($errno)");

        $name = stream_socket_get_name($this->server, false);
        $port = (int) substr($name, strrpos($name, ':') + 1);

        return ['host' => '127.0.0.1', 'port' => $port];
    }

    public function test_a_silent_mail_host_aborts_the_send_at_the_configured_timeout(): void
    {
        $target = $this->silentServer();

        config([
            'mail.mailers.smtp.host' => $target['host'],
            'mail.mailers.smtp.port' => $target['port'],
            'mail.mailers.smtp.encryption' => 'none',
            'mail.mailers.smtp.timeout' => 2,
            'mail.platform_provider' => 'smtp',
        ]);

        $mailer = new Mailer();

        $started = microtime(true);
        $sent = $mailer->send('someone@example.com', 'Subject', '<p>Body</p>');
        $elapsed = microtime(true) - $started;

        // The send fails — the point is that it fails PROMPTLY.
        $this->assertFalse($sent, 'a silent host must not report a successful send');

        // Bounded by the configured timeout, not php.ini's 60s default. The
        // upper bound is deliberately loose (CI is slow) but far below the 60s
        // a single unbounded read used to allow.
        $this->assertLessThan(
            15.0,
            $elapsed,
            sprintf('send against a silent host took %.1fs; the read timeout is not being applied', $elapsed)
        );
    }

    public function test_the_timeout_comes_from_config_so_operators_can_tune_it(): void
    {
        $target = $this->silentServer();

        config([
            'mail.mailers.smtp.host' => $target['host'],
            'mail.mailers.smtp.port' => $target['port'],
            'mail.mailers.smtp.encryption' => 'none',
            'mail.mailers.smtp.timeout' => 1,
            'mail.platform_provider' => 'smtp',
        ]);

        $started = microtime(true);
        (new Mailer())->send('someone@example.com', 'Subject', '<p>Body</p>');
        $oneSecond = microtime(true) - $started;

        config(['mail.mailers.smtp.timeout' => 4]);

        $started = microtime(true);
        (new Mailer())->send('someone@example.com', 'Subject', '<p>Body</p>');
        $fourSeconds = microtime(true) - $started;

        // A larger configured timeout must actually wait longer, which proves
        // the value is being honoured rather than some fixed internal default
        // happening to be small.
        $this->assertGreaterThan(
            $oneSecond + 1.0,
            $fourSeconds,
            sprintf('timeout=1 took %.1fs and timeout=4 took %.1fs; config is not driving the wait', $oneSecond, $fourSeconds)
        );
    }

    public function test_the_default_timeout_is_short_enough_for_a_member_facing_write(): void
    {
        // The accessible frontend gives an API call 15s
        // (web-uk/src/lib/api.js DEFAULT_API_REQUEST_TIMEOUT_MS). A mail wait
        // anywhere near that turns a completed action into a visible failure.
        $this->assertLessThanOrEqual(
            10,
            (int) config('mail.mailers.smtp.timeout'),
            'the default SMTP timeout is long enough to blow the accessible frontend request budget'
        );
    }
}
