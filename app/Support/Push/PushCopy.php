<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Push;

/**
 * The lock-screen copy catalogue for native (Expo / FCM) push.
 *
 * A pure, database-free renderer. It is called inside the RECIPIENT's
 * LocaleContext (FCMPushService enters one per device-token locale group), so
 * everything it returns is already in the member's language.
 *
 * Producers describe what happened with a small, whitelisted context
 * (`actor`, `subject`, `time`, `count`, `hours`, `preview`, `thread_id`).
 * Every value is sanitised and capped here, so a producer can never put
 * markup, a newline or an unbounded string on a lock screen, and a key this
 * class does not know is dropped rather than forwarded.
 *
 * Why these facts are allowed on a lock screen (Apple App Review 4.5.4): a
 * member's display name, an event / listing / badge title, an hour count and a
 * time are already visible to every member of the community and already
 * arrive in the recipient's inbox and email. Message text is the one private
 * value: `preview` only reaches this class when the recipient has opted in
 * (`push_show_message_preview`, enforced in FCMPushService::sendToUser), and
 * it is capped at 80 characters.
 *
 * Deliberately kept out of NotificationDispatcher so the inventory of
 * dispatcher entry points pinned by NativePushProducerInventoryTest is
 * untouched.
 */
final class PushCopy
{
    /** Placeholder whitelist with the maximum length each value may have. */
    public const CONTEXT_LIMITS = [
        'actor' => 60,
        'subject' => 80,
        'time' => 40,
        'count' => 6,
        'hours' => 10,
        'preview' => 80,
    ];

    /** `<kind>:<id>` — what the phone uses to group and clear tray alerts. */
    private const THREAD_ID_PATTERN = '/^[a-z_]{1,20}:[0-9]{1,19}$/';

    private const TITLE_LIMIT = 80;

    private const BODY_LIMIT = 180;

    /**
     * Every type with a `notifications.push.<type>` entry. Kept as a list (not
     * discovered from the lang file) so a typo in one locale cannot silently
     * shrink the catalogue.
     *
     * @var list<string>
     */
    private const CURATED_TYPES = [
        'new_message',
        'connection_request',
        'connection_accepted',
        'transaction',
        'event_reminder',
        'event_invitation',
        'event_cancelled',
        'vol_shift_reminder',
        'vol_shift_cancelled',
        'exchange_request_received',
        'exchange_accepted',
        'achievement',
        'group_join_request',
        'comment',
        'comment_reply',
        'mention',
        'moderation',
    ];

    /**
     * Catalogue entries with no placeholder: they render without any producer
     * facts. Every other entry needs at least one fact, otherwise a producer
     * that passed no context would get a headless "New message from".
     *
     * @var list<string>
     */
    private const CONTEXT_FREE_TYPES = ['moderation'];

    /** Types whose channel is the high-importance `messages` channel on Android. */
    private const MESSAGE_TYPES = ['new_message', 'group_chatroom_message'];

    /** Types delivered at high priority so they arrive promptly and pop up. */
    private const TIME_SENSITIVE_TYPES = [
        'new_message',
        'group_chatroom_message',
        'event_reminder',
        'vol_shift_reminder',
    ];

    /** @return list<string> */
    public static function curatedTypes(): array
    {
        return self::CURATED_TYPES;
    }

    public static function isCurated(string $type): bool
    {
        return in_array($type, self::CURATED_TYPES, true);
    }

    /**
     * Render the recipient-locale title and body for a curated type, or null
     * when the type is not in the catalogue (the caller then falls back).
     *
     * Unset placeholders are filled with '' so a literal `:subject` can never
     * reach a lock screen. The `new_message` body switches to the preview
     * variant only when a preview survived the preference gate upstream.
     *
     * @param array<string, mixed> $context
     * @return array{title: string, body: string}|null
     */
    public static function render(string $type, array $context): ?array
    {
        if (!self::isCurated($type)) {
            return null;
        }

        $clean = self::sanitiseContext($context);
        $facts = array_diff_key($clean, ['thread_id' => true]);
        if ($facts === [] && !in_array($type, self::CONTEXT_FREE_TYPES, true)) {
            return null;
        }

        $titleKey = 'notifications.push.' . $type . '.title';
        // Every placeholder the title names must have a fact behind it. A missing
        // one would render as '' and leave a headless "You received 1.5 hours from";
        // the caller's curated title + generic body is better than that.
        $template = self::translate($titleKey, []);
        if ($template === null) {
            return null;
        }
        if (preg_match_all('/:([a-z_]+)\b/', $template, $matches) > 0) {
            foreach (array_unique($matches[1]) as $placeholder) {
                if (!isset($facts[$placeholder])) {
                    return null;
                }
            }
        }

        $replacements = array_fill_keys(array_keys(self::CONTEXT_LIMITS), '');
        foreach (self::CONTEXT_LIMITS as $key => $limit) {
            if (isset($clean[$key])) {
                $replacements[$key] = $clean[$key];
            }
        }

        $title = self::translate($titleKey, $replacements);
        if ($title === null) {
            return null;
        }

        $body = null;
        if ($type === 'new_message' && ($clean['preview'] ?? '') !== '') {
            $body = self::translate('notifications.push.' . $type . '.body_preview', $replacements);
        }
        $body ??= self::translate('notifications.push.' . $type . '.body', $replacements);
        if ($body === null) {
            return null;
        }

        $title = self::clamp(self::collapseWhitespace($title), self::TITLE_LIMIT);
        $body = self::clamp(self::collapseWhitespace($body), self::BODY_LIMIT);

        if ($title === '') {
            return null;
        }
        if ($body === '') {
            // A body made only of a placeholder the producer did not supply.
            // The generic sentence is the safe floor, never an empty alert.
            $body = (string) __('notifications.push_private_body');
        }

        return ['title' => $title, 'body' => $body];
    }

    /**
     * Keep only whitelisted keys, as plain single-line text within their caps.
     *
     * @param array<string, mixed> $context
     * @return array<string, string>
     */
    public static function sanitiseContext(array $context): array
    {
        $clean = [];
        foreach (self::CONTEXT_LIMITS as $key => $limit) {
            if (!array_key_exists($key, $context) || !is_scalar($context[$key])) {
                continue;
            }
            $value = self::plainText((string) $context[$key]);
            if ($value === '') {
                continue;
            }
            $clean[$key] = self::clamp($value, $limit, false);
        }

        $threadId = $context['thread_id'] ?? null;
        if (is_string($threadId) && preg_match(self::THREAD_ID_PATTERN, $threadId) === 1) {
            $clean['thread_id'] = $threadId;
        }

        return $clean;
    }

    /**
     * The fallback body for an uncatalogued dispatcher push: the recipient's own
     * bell sentence, reduced to plain single-line text within the body cap.
     */
    public static function plainBody(string $text): string
    {
        return self::clamp(self::plainText($text), self::BODY_LIMIT);
    }

    /** Android notification channel for a delivery. */
    public static function channelFor(string $type, bool $emergency): string
    {
        if ($emergency) {
            return 'emergency';
        }

        return in_array($type, self::MESSAGE_TYPES, true) ? 'messages' : 'default';
    }

    /** Whether a type should be delivered at high priority (prompt, heads-up). */
    public static function isTimeSensitive(string $type): bool
    {
        return in_array($type, self::TIME_SENSITIVE_TYPES, true)
            || str_contains(strtolower($type), 'emergency');
    }

    /** @param array<string, string> $replacements */
    private static function translate(string $key, array $replacements): ?string
    {
        $rendered = __($key, $replacements);
        if (!is_string($rendered) || $rendered === $key) {
            return null;
        }

        return $rendered;
    }

    /** Strip tags, control characters and line breaks; collapse runs of whitespace. */
    private static function plainText(string $value): string
    {
        $value = strip_tags($value);
        $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = (string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value);

        return self::collapseWhitespace($value);
    }

    private static function collapseWhitespace(string $value): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $value));
    }

    private static function clamp(string $value, int $limit, bool $ellipsis = true): string
    {
        if (mb_strlen($value) <= $limit) {
            return $value;
        }
        if (!$ellipsis || $limit < 2) {
            return mb_substr($value, 0, $limit);
        }

        return rtrim(mb_substr($value, 0, $limit - 1)) . '…';
    }
}
