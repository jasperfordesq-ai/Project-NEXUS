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
 * The hand-rolled SMTP client read each reply but never checked its code, so a
 * server that refused the message (for example `550` after DATA) was reported
 * as a successful send. The registration staff-alert ledger treats a successful
 * send as accepted, so a refused alert was never recovered.
 *
 * A send blocks this process, so the scripted SMTP server runs as a child PHP
 * process that answers each command with a planned reply code.
 */
class MailerSmtpReplyCodeTest extends TestCase
{
    /** @var resource|null */
    private $process = null;

    /** @var array<int, resource> */
    private array $pipes = [];

    private ?string $script = null;

    protected function tearDown(): void
    {
        foreach ($this->pipes as $pipe) {
            if (is_resource($pipe)) {
                fclose($pipe);
            }
        }
        if (is_resource($this->process)) {
            proc_terminate($this->process);
            proc_close($this->process);
        }
        if ($this->script !== null && is_file($this->script)) {
            unlink($this->script);
        }
        parent::tearDown();
    }

    /** @param array{rcpt?: int, data_end?: int, mail?: int} $plan */
    private function stubServer(array $plan): int
    {
        $this->script = tempnam(sys_get_temp_dir(), 'smtp-stub-') . '.php';
        file_put_contents($this->script, <<<'PHP'
<?php
$plan = json_decode($argv[1], true);
$server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
$name = stream_socket_get_name($server, false);
fwrite(STDOUT, substr($name, strrpos($name, ':') + 1) . "\n");
fflush(STDOUT);
$c = stream_socket_accept($server, 20);
if (!$c) { exit(1); }
fwrite($c, "220 stub ready\r\n");
$authStep = 0;
$inData = false;
while (($line = fgets($c)) !== false) {
    $l = rtrim($line, "\r\n");
    if ($inData) {
        if ($l === '.') {
            $inData = false;
            fwrite($c, ($plan['data_end'] ?? 250) . " end of data\r\n");
        }
        continue;
    }
    if ($authStep === 1) { $authStep = 2; fwrite($c, "334 UGFzc3dvcmQ6\r\n"); continue; }
    if ($authStep === 2) { $authStep = 0; fwrite($c, "235 authenticated\r\n"); continue; }
    $cmd = strtoupper(substr($l, 0, 4));
    if ($cmd === 'EHLO') { fwrite($c, "250-stub\r\n250 AUTH LOGIN\r\n"); }
    elseif ($cmd === 'AUTH') { $authStep = 1; fwrite($c, "334 VXNlcm5hbWU6\r\n"); }
    elseif ($cmd === 'MAIL') { fwrite($c, ($plan['mail'] ?? 250) . " sender\r\n"); }
    elseif ($cmd === 'RCPT') { fwrite($c, ($plan['rcpt'] ?? 250) . " recipient\r\n"); }
    elseif ($cmd === 'DATA') { $inData = true; fwrite($c, "354 go ahead\r\n"); }
    elseif ($cmd === 'QUIT') { fwrite($c, "221 bye\r\n"); break; }
    else { fwrite($c, "500 unknown\r\n"); }
}
fclose($c);
PHP);
        $this->process = proc_open(
            [PHP_BINARY, $this->script, json_encode($plan)],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $this->pipes
        );
        $this->assertIsResource($this->process, 'could not start the SMTP stub');
        stream_set_timeout($this->pipes[1], 10);
        $port = (int) trim((string) fgets($this->pipes[1]));
        $this->assertGreaterThan(0, $port, 'the SMTP stub did not report its port');

        return $port;
    }

    private function sendThrough(int $port): bool
    {
        config([
            'mail.mailers.smtp.host' => '127.0.0.1',
            'mail.mailers.smtp.port' => $port,
            'mail.mailers.smtp.encryption' => 'none',
            'mail.mailers.smtp.timeout' => 5,
            'mail.mailers.smtp.username' => 'stub-user',
            'mail.mailers.smtp.password' => 'stub-password',
            'mail.platform_provider' => 'smtp',
        ]);

        return (new Mailer())->send('someone@example.com', 'Subject', '<p>Body</p>');
    }

    public function test_a_message_the_server_accepts_is_reported_as_sent(): void
    {
        $this->assertTrue($this->sendThrough($this->stubServer([])));
    }

    public function test_a_message_refused_after_data_is_not_reported_as_sent(): void
    {
        $this->assertFalse($this->sendThrough($this->stubServer(['data_end' => 550])),
            'a 550 to the end of DATA means the server did not accept the message');
    }

    public function test_a_refused_recipient_is_not_reported_as_sent(): void
    {
        $this->assertFalse($this->sendThrough($this->stubServer(['rcpt' => 550])));
    }

    public function test_a_temporary_refusal_after_data_is_not_reported_as_sent(): void
    {
        $this->assertFalse($this->sendThrough($this->stubServer(['data_end' => 451])));
    }

    public function test_a_forwarded_recipient_is_still_accepted(): void
    {
        $this->assertTrue($this->sendThrough($this->stubServer(['rcpt' => 251])));
    }
}
