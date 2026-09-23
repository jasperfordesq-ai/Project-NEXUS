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
 * F-063 (E-027) — the hand-rolled SMTP client must dot-stuff the DATA block
 * (RFC 5321 section 4.5.2) and send CRLF line endings, so member text with a
 * line that is just "." (or starts with ".") cannot end or alter the message.
 *
 * The SMTP conversation runs over a local socket pair: the "server" end has
 * the replies queued in advance and captures everything the mailer writes.
 */
final class MailerSmtpDataTest extends TestCase
{
    /** @var array<int,resource> */
    private array $pair = [];

    protected function tearDown(): void
    {
        foreach ($this->pair as $end) {
            if (is_resource($end)) {
                fclose($end);
            }
        }
        parent::tearDown();
    }

    private function sendDataOverPair(string $body, ?string $textBody = null): string
    {
        $pair = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
        $this->assertIsArray($pair);
        $this->pair = $pair;
        [$client, $server] = $pair;

        // MAIL FROM, RCPT TO, DATA, end-of-data.
        fwrite($server, "250 OK\r\n250 OK\r\n354 Go ahead\r\n250 Queued\r\n");

        $mailer = new Mailer();
        $ref = new \ReflectionClass($mailer);
        $ref->getProperty('socket')->setValue($mailer, $client);
        $ref->getProperty('timeout')->setValue($mailer, 2);
        stream_set_timeout($client, 2);
        $ref->getMethod('sendData')->invoke($mailer, 'to@example.com', 'Subject', $body, null, null, null, $textBody);

        stream_set_blocking($server, false);
        $wire = '';
        while (($chunk = fread($server, 65536)) !== false && $chunk !== '') {
            $wire .= $chunk;
        }

        return $wire;
    }

    public function test_body_lines_starting_with_a_dot_are_stuffed_and_terminator_is_unique(): void
    {
        $wire = $this->sendDataOverPair("<p>first</p>\n.\n.hidden line\r\n<p>last</p>");

        $data = substr($wire, (int) strpos($wire, "DATA\r\n") + strlen("DATA\r\n"));

        // The lone "." and ".hidden" lines are doubled on the wire.
        $this->assertStringContainsString("\r\n..\r\n", $data);
        $this->assertStringContainsString("\r\n..hidden line\r\n", $data);

        // Exactly one end-of-data marker, at the very end.
        $this->assertStringEndsWith("\r\n.\r\n", $data);
        $this->assertSame(1, substr_count($data, "\r\n.\r\n"), 'a body line must not terminate DATA early');

        // Every line ending is CRLF (no bare LF or CR).
        $this->assertSame(0, preg_match('/(?<!\r)\n|\r(?!\n)/', $data), 'bare LF/CR found in DATA block');

        // Control: the rest of the content is intact.
        $this->assertStringContainsString('<p>first</p>', $data);
        $this->assertStringContainsString('<p>last</p>', $data);
    }

    public function test_control_multipart_message_still_has_one_terminator(): void
    {
        $wire = $this->sendDataOverPair('<p>html</p>', "plain\n.\ntext");
        $data = substr($wire, (int) strpos($wire, "DATA\r\n") + strlen("DATA\r\n"));

        $this->assertStringContainsString('Content-Type: multipart/alternative', $data);
        $this->assertStringEndsWith("\r\n.\r\n", $data);
        $this->assertSame(1, substr_count($data, "\r\n.\r\n"));
    }
}
