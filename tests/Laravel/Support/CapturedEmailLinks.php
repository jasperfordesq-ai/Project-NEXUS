<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Support;

use App\Services\EmailDispatchService;
use PHPUnit\Framework\Assert;

/**
 * Captures every email a sender hands to EmailDispatchService and lets a test
 * check that every link in it belongs to the community it was sent for.
 *
 * Every sender in app/ reaches EmailDispatchService::send(), so binding this
 * double sees the final HTML body plus the List-Unsubscribe URL the Mailer
 * would have put in the headers.
 */
final class CapturedEmailLinks extends EmailDispatchService
{
    /** @var list<array{to:string, subject:string, body:string, options:array<string,mixed>}> */
    public array $sent = [];

    public static function install(): self
    {
        $instance = new self();
        app()->instance(EmailDispatchService::class, $instance);

        return $instance;
    }

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body, 'options' => $options];

        return true;
    }

    /** @return list<string> every href/src in every body, plus every List-Unsubscribe URL */
    public function links(): array
    {
        $out = [];
        foreach ($this->sent as $message) {
            preg_match_all('#(?:href|src)=["\']([^"\']+)["\']#i', $message['body'], $matches);
            foreach ($matches[1] as $url) {
                $out[] = html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            }
            $unsubscribe = $message['options']['unsubscribeUrl'] ?? null;
            if (is_string($unsubscribe) && $unsubscribe !== '') {
                $out[] = $unsubscribe;
            }
        }

        return array_values(array_unique($out));
    }

    /**
     * Every link must be either an API endpoint on the API host, or a page on
     * this community's own address whose first path segment is a page that
     * exists in the React app.
     *
     * @param list<string> $allowedFirstSegments
     * @param list<string> $extraBases other addresses a link may legitimately start with (e.g. the accessible site)
     */
    public function assertAllLinksBelongTo(string $host, string $prefix, string $apiHost, array $allowedFirstSegments, array $extraBases = []): void
    {
        $links = $this->links();
        Assert::assertNotEmpty($links, 'no links were captured — did the sender run?');

        foreach ($links as $url) {
            if (preg_match('#^(mailto:|data:|cid:|tel:|\#)#i', $url)) {
                continue;
            }
            // API endpoints and files are served from the API host directly, and
            // every community host proxies /api/ to Laravel (never /{slug}/api/).
            if (str_starts_with($url, rtrim($apiHost, '/') . '/api/')
                || str_starts_with($url, rtrim($apiHost, '/') . '/storage/')
                || str_starts_with($url, $host . '/api/')) {
                continue;
            }
            $onExtraBase = false;
            foreach ($extraBases as $extra) {
                if ($url === $extra || str_starts_with($url, $extra . '/') || str_starts_with($url, $extra . '?')) {
                    $onExtraBase = true;
                }
            }
            if ($onExtraBase) {
                continue;
            }

            $base = $host . $prefix;
            Assert::assertTrue(
                $url === $base || str_starts_with($url, $base . '/') || str_starts_with($url, $base . '?'),
                "link is not on this community's address ({$base}/...): {$url}"
            );

            $rest = substr($url, strlen($base));
            $path = (string) parse_url($rest, PHP_URL_PATH);
            $first = explode('/', trim($path, '/'))[0] ?? '';
            if ($first === '') {
                continue; // the community home page
            }
            Assert::assertContains($first, $allowedFirstSegments, "link path has no page in the React app: {$url}");
        }
    }
}
