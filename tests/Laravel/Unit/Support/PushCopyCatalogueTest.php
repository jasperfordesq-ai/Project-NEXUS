<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Support;

use App\I18n\LocaleContext;
use App\Support\Push\PushCopy;
use Tests\Laravel\TestCase;

/**
 * The lock-screen copy catalogue: every curated push type renders a real
 * title and body in every locale, with nothing untrusted and no placeholder
 * left behind.
 */
class PushCopyCatalogueTest extends TestCase
{
    private const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];

    private const FULL_CONTEXT = [
        'actor' => 'Alice',
        'subject' => 'Garden Day',
        'time' => 'tomorrow at 10:00',
        'count' => '3',
        'hours' => '1.5',
        'preview' => 'Hello there',
        'thread_id' => 'message:10',
    ];

    public function test_every_curated_type_renders_a_title_and_body_in_every_locale(): void
    {
        $types = PushCopy::curatedTypes();
        $this->assertContains('new_message', $types);
        $this->assertContains('moderation', $types);

        foreach (self::LOCALES as $locale) {
            foreach ($types as $type) {
                $copy = LocaleContext::withLocale($locale, static fn (): ?array => PushCopy::render($type, self::FULL_CONTEXT));

                $this->assertIsArray($copy, "{$locale}/{$type} did not render");
                foreach (['title', 'body'] as $part) {
                    $text = $copy[$part];
                    $this->assertNotSame('', trim($text), "{$locale}/{$type} {$part} is empty");
                    $this->assertStringNotContainsString('notifications.push', $text, "{$locale}/{$type} {$part} leaked the raw key");
                    // Any `:word` — a translator-mangled `:acteur` must fail too.
                    // (`time` renders as "tomorrow at 10:00": digits after the colon.)
                    $this->assertDoesNotMatchRegularExpression(
                        '/:[a-z_]{2,}/u',
                        $text,
                        "{$locale}/{$type} {$part} left a placeholder: {$text}",
                    );
                }
            }
        }
    }

    public function test_english_copy_names_the_person_and_the_thing(): void
    {
        $this->assertSame(
            ['title' => 'New message from Alice', 'body' => 'Tap to read and reply'],
            PushCopy::render('new_message', ['actor' => 'Alice']),
        );
        $this->assertSame(
            ['title' => 'Reminder: Garden Day starts tomorrow at 10:00', 'body' => 'Tap for the details'],
            PushCopy::render('event_reminder', ['subject' => 'Garden Day', 'time' => 'tomorrow at 10:00']),
        );
        $this->assertSame(
            ['title' => 'You received 1.5 hours from Alice', 'body' => 'Tap to see your wallet'],
            PushCopy::render('transaction', ['actor' => 'Alice', 'hours' => '1.5']),
        );
    }

    public function test_unknown_type_renders_nothing(): void
    {
        $this->assertNull(PushCopy::render('new_topic', self::FULL_CONTEXT));
        $this->assertNull(PushCopy::render('', self::FULL_CONTEXT));
        $this->assertNull(PushCopy::render('../../etc', self::FULL_CONTEXT));
    }

    public function test_new_message_shows_the_preview_only_when_one_survived(): void
    {
        $without = PushCopy::render('new_message', ['actor' => 'Alice']);
        $with = PushCopy::render('new_message', ['actor' => 'Alice', 'preview' => 'Hello there']);

        $this->assertSame('Tap to read and reply', $without['body']);
        $this->assertSame('Hello there', $with['body']);
        $this->assertSame('New message from Alice', $with['title']);
    }

    public function test_an_entry_renders_only_when_every_title_placeholder_is_present(): void
    {
        // A headless "New message from" or "You received 1.5 hours from" is
        // worse than the curated title + generic body the caller falls back to.
        $this->assertNull(PushCopy::render('new_message', ['subject' => 'unused']));
        $this->assertNull(PushCopy::render('transaction', ['hours' => '1.5']));
        $this->assertNull(PushCopy::render('transaction', ['actor' => 'Alice']));
        $this->assertNull(PushCopy::render('event_reminder', ['subject' => 'Garden Day']));

        $this->assertSame(
            ['title' => 'You received 1.5 hours from Alice', 'body' => 'Tap to see your wallet'],
            PushCopy::render('transaction', ['actor' => 'Alice', 'hours' => '1.5']),
        );
    }

    public function test_an_entry_with_placeholders_needs_at_least_one_fact(): void
    {
        // A direct producer that passes nothing keeps today's curated title and
        // generic body rather than a headless "New message from".
        $this->assertNull(PushCopy::render('new_message', []));
        $this->assertNull(PushCopy::render('new_message', ['thread_id' => 'message:10']));
        $this->assertNull(PushCopy::render('event_reminder', ['secret' => 'dropped']));

        // Entries without placeholders render on their own.
        $this->assertSame(
            ['title' => 'Moderation update', 'body' => 'Tap for the details'],
            PushCopy::render('moderation', []),
        );
    }

    public function test_sanitise_drops_unknown_keys_and_strips_markup_and_newlines(): void
    {
        $this->assertSame(
            ['actor' => 'Al ice', 'subject' => 'Garden Day'],
            PushCopy::sanitiseContext([
                'actor' => "<b>Al</b>\nice",
                'subject' => "Garden\r\n\tDay\x07",
                'secret' => 'must not pass',
                'link' => '/evil',
                'nested' => ['actor' => 'x'],
            ]),
        );
    }

    public function test_sanitise_caps_every_value_at_its_limit(): void
    {
        $context = PushCopy::sanitiseContext([
            'actor' => str_repeat('a', 100),
            'subject' => str_repeat('s', 100),
            'time' => str_repeat('t', 100),
            'count' => '1234567890',
            'hours' => '12345678901234',
            'preview' => str_repeat('p', 100),
        ]);

        $this->assertSame(60, mb_strlen($context['actor']));
        $this->assertSame(80, mb_strlen($context['subject']));
        $this->assertSame(40, mb_strlen($context['time']));
        $this->assertSame(6, mb_strlen($context['count']));
        $this->assertSame(10, mb_strlen($context['hours']));
        $this->assertSame(80, mb_strlen($context['preview']));
    }

    public function test_sanitise_keeps_only_a_well_formed_thread_id(): void
    {
        $this->assertSame(['thread_id' => 'message:10'], PushCopy::sanitiseContext(['thread_id' => 'message:10']));

        foreach (['message:abc', 'Message:10', 'message:', ':10', 'message:10; drop', str_repeat('m', 21) . ':1', 'message:' . str_repeat('9', 20)] as $bad) {
            $this->assertSame([], PushCopy::sanitiseContext(['thread_id' => $bad]), "accepted thread_id {$bad}");
        }
    }

    public function test_rendered_title_and_body_are_clamped(): void
    {
        $copy = PushCopy::render('event_reminder', [
            'subject' => str_repeat('s', 80),
            'time' => str_repeat('t', 40),
        ]);

        $this->assertLessThanOrEqual(80, mb_strlen($copy['title']));
        $this->assertLessThanOrEqual(180, mb_strlen($copy['body']));
    }

    public function test_channel_map_and_time_sensitivity(): void
    {
        $this->assertSame('messages', PushCopy::channelFor('new_message', false));
        $this->assertSame('messages', PushCopy::channelFor('group_chatroom_message', false));
        $this->assertSame('default', PushCopy::channelFor('event_reminder', false));
        $this->assertSame('default', PushCopy::channelFor('', false));
        $this->assertSame('emergency', PushCopy::channelFor('volunteer_emergency', true));
        $this->assertSame('emergency', PushCopy::channelFor('new_message', true));

        $this->assertTrue(PushCopy::isTimeSensitive('new_message'));
        $this->assertTrue(PushCopy::isTimeSensitive('event_reminder'));
        $this->assertTrue(PushCopy::isTimeSensitive('vol_shift_reminder'));
        $this->assertTrue(PushCopy::isTimeSensitive('volunteer_emergency'));
        $this->assertFalse(PushCopy::isTimeSensitive('comment'));
        $this->assertFalse(PushCopy::isTimeSensitive('new_topic'));
    }
}
