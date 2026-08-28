<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Tests\Helpers;

use App\Tests\TestCase;
use App\Helpers\TimeHelper;

/**
 * TimeHelper Tests
 *
 * Tests time formatting utilities including:
 * - Human-readable "time ago" formatting
 * - Date formatting
 * - Date and time formatting
 *
 * @covers \App\Helpers\TimeHelper
 */
class TimeHelperTest extends TestCase
{
    // =========================================================================
    // CLASS STRUCTURE TESTS
    // =========================================================================

    public function testClassExists(): void
    {
        $this->assertTrue(class_exists(TimeHelper::class));
    }

    public function testPublicMethodsExist(): void
    {
        $methods = ['timeAgo', 'format', 'formatWithTime'];

        foreach ($methods as $method) {
            $this->assertTrue(
                method_exists(TimeHelper::class, $method),
                "Method {$method} should exist on TimeHelper"
            );
        }
    }

    // =========================================================================
    // TIME AGO TESTS - RECENT
    // =========================================================================

    public function testTimeAgoJustNow(): void
    {
        $now = time();
        $this->assertEquals('Just now', TimeHelper::timeAgo($now));
        $this->assertEquals('Just now', TimeHelper::timeAgo($now - 30)); // 30 seconds ago
        $this->assertEquals('Just now', TimeHelper::timeAgo($now - 59)); // 59 seconds ago
    }

    public function testTimeAgoFutureDate(): void
    {
        $future = time() + 3600; // 1 hour in the future
        $this->assertEquals('Just now', TimeHelper::timeAgo($future));
    }

    public function testTimeAgoMinutes(): void
    {
        $now = time();
        $this->assertEquals('1 minute ago', TimeHelper::timeAgo($now - 60));
        $this->assertEquals('1 minute ago', TimeHelper::timeAgo($now - 119)); // 1.9 minutes
        $this->assertEquals('2 minutes ago', TimeHelper::timeAgo($now - 120));
        $this->assertEquals('30 minutes ago', TimeHelper::timeAgo($now - 1800));
        $this->assertEquals('59 minutes ago', TimeHelper::timeAgo($now - 3540));
    }

    public function testTimeAgoHours(): void
    {
        $now = time();
        $this->assertEquals('1 hour ago', TimeHelper::timeAgo($now - 3600));
        $this->assertEquals('2 hours ago', TimeHelper::timeAgo($now - 7200));
        $this->assertEquals('12 hours ago', TimeHelper::timeAgo($now - 43200));
        $this->assertEquals('23 hours ago', TimeHelper::timeAgo($now - 82800));
    }

    public function testTimeAgoDays(): void
    {
        $now = time();
        $this->assertEquals('1 day ago', TimeHelper::timeAgo($now - 86400));
        $this->assertEquals('2 days ago', TimeHelper::timeAgo($now - 172800));
        $this->assertEquals('5 days ago', TimeHelper::timeAgo($now - 432000));
    }

    public function testTimeAgoWeeks(): void
    {
        $now = time();
        $this->assertEquals('1 week ago', TimeHelper::timeAgo($now - 604800));
        $this->assertEquals('2 weeks ago', TimeHelper::timeAgo($now - 1209600));
        $this->assertEquals('3 weeks ago', TimeHelper::timeAgo($now - 1814400));
    }

    public function testTimeAgoMonths(): void
    {
        $now = time();
        $this->assertEquals('1 month ago', TimeHelper::timeAgo($now - 2592000)); // ~30 days
        $this->assertEquals('2 months ago', TimeHelper::timeAgo($now - 5184000)); // ~60 days
        $this->assertEquals('6 months ago', TimeHelper::timeAgo($now - 15552000)); // ~180 days
    }

    public function testTimeAgoYears(): void
    {
        $now = time();
        $this->assertEquals('1 year ago', TimeHelper::timeAgo($now - 31536000)); // ~365 days
        $this->assertEquals('2 years ago', TimeHelper::timeAgo($now - 63072000)); // ~730 days
        $this->assertEquals('10 years ago', TimeHelper::timeAgo($now - 315360000));
    }

    // =========================================================================
    // TIME AGO - DATE STRING INPUT
    // =========================================================================

    public function testTimeAgoWithDateString(): void
    {
        $dateTime = date('Y-m-d H:i:s', time() - 3600); // 1 hour ago
        $result = TimeHelper::timeAgo($dateTime);
        $this->assertEquals('1 hour ago', $result);
    }

    public function testTimeAgoWithInvalidDateString(): void
    {
        $result = TimeHelper::timeAgo('invalid-date');
        $this->assertEquals('Unknown', $result);
    }

    public function testTimeAgoWithEmptyString(): void
    {
        $result = TimeHelper::timeAgo('');
        $this->assertEquals('Unknown', $result);
    }

    // =========================================================================
    // FORMAT TESTS
    // =========================================================================

    public function testFormatWithDefaultFormat(): void
    {
        $timestamp = strtotime('2026-01-15 14:30:00');
        $result = TimeHelper::format($timestamp);

        // Day-first: month-first is American, and this platform's communities
        // are in Ireland and the UK. An explicit format argument is still
        // honoured verbatim — see testFormatWithVariousFormats below.
        $this->assertEquals('15 Jan 2026', $result);
    }

    public function testFormatWithCustomFormat(): void
    {
        $timestamp = strtotime('2026-01-15 14:30:00');
        $result = TimeHelper::format($timestamp, 'Y-m-d');

        $this->assertEquals('2026-01-15', $result);
    }

    public function testFormatWithDateString(): void
    {
        $result = TimeHelper::format('2026-01-15 14:30:00', 'M j, Y');

        $this->assertEquals('Jan 15, 2026', $result);
    }

    public function testFormatWithInvalidDate(): void
    {
        $result = TimeHelper::format('invalid-date');

        $this->assertEquals('Unknown', $result);
    }

    public function testFormatWithVariousFormats(): void
    {
        $timestamp = strtotime('2026-01-15 14:30:00');

        $this->assertEquals('2026-01-15', TimeHelper::format($timestamp, 'Y-m-d'));
        $this->assertEquals('15/01/2026', TimeHelper::format($timestamp, 'd/m/Y'));
        $this->assertEquals('January 15, 2026', TimeHelper::format($timestamp, 'F j, Y'));
        // 15 January 2026 is a Thursday. This asserted 'Wed' and was failing
        // before the date-format work began — an incorrect constant, unrelated
        // to field order.
        $this->assertEquals('Thu, Jan 15, 2026', TimeHelper::format($timestamp, 'D, M j, Y'));
    }

    // =========================================================================
    // FORMAT WITH TIME TESTS
    // =========================================================================

    public function testFormatWithTime(): void
    {
        $timestamp = strtotime('2026-01-15 14:30:00');
        $result = TimeHelper::formatWithTime($timestamp);

        $this->assertEquals('15 Jan 2026 at 14:30', $result);
    }

    public function testFormatWithTimeAM(): void
    {
        $timestamp = strtotime('2026-01-15 09:15:00');
        $result = TimeHelper::formatWithTime($timestamp);

        $this->assertEquals('15 Jan 2026 at 09:15', $result);
    }

    public function testFormatWithTimeNoon(): void
    {
        $timestamp = strtotime('2026-01-15 12:00:00');
        $result = TimeHelper::formatWithTime($timestamp);

        $this->assertEquals('15 Jan 2026 at 12:00', $result);
    }

    public function testFormatWithTimeMidnight(): void
    {
        $timestamp = strtotime('2026-01-15 00:00:00');
        $result = TimeHelper::formatWithTime($timestamp);

        $this->assertEquals('15 Jan 2026 at 00:00', $result);
    }

    public function testFormatWithTimeFromDateString(): void
    {
        $result = TimeHelper::formatWithTime('2026-01-15 14:30:00');

        $this->assertEquals('15 Jan 2026 at 14:30', $result);
    }

    public function testFormatWithTimeInvalidDate(): void
    {
        $result = TimeHelper::formatWithTime('invalid-date');

        $this->assertEquals('Unknown', $result);
    }

    // =========================================================================
    // EDGE CASES
    // =========================================================================

    public function testTimeAgoWithZeroTimestamp(): void
    {
        // Unix epoch (1970-01-01)
        $result = TimeHelper::timeAgo(0);

        // Should return years ago
        $this->assertStringContainsString('years ago', $result);
    }

    public function testFormatWithZeroTimestamp(): void
    {
        $result = TimeHelper::format(0);

        // Should format the epoch
        $this->assertEquals('1 Jan 1970', $result);
    }

    public function testTimeAgoSingularVsPluralForms(): void
    {
        $now = time();

        // Singular forms
        $this->assertStringContainsString('1 minute ago', TimeHelper::timeAgo($now - 60));
        $this->assertStringContainsString('1 hour ago', TimeHelper::timeAgo($now - 3600));
        $this->assertStringContainsString('1 day ago', TimeHelper::timeAgo($now - 86400));
        $this->assertStringContainsString('1 week ago', TimeHelper::timeAgo($now - 604800));
        $this->assertStringContainsString('1 month ago', TimeHelper::timeAgo($now - 2592000));
        $this->assertStringContainsString('1 year ago', TimeHelper::timeAgo($now - 31536000));

        // Plural forms
        $this->assertStringContainsString('2 minutes ago', TimeHelper::timeAgo($now - 120));
        $this->assertStringContainsString('2 hours ago', TimeHelper::timeAgo($now - 7200));
        $this->assertStringContainsString('2 days ago', TimeHelper::timeAgo($now - 172800));
        $this->assertStringContainsString('2 weeks ago', TimeHelper::timeAgo($now - 1209600));
        $this->assertStringContainsString('2 months ago', TimeHelper::timeAgo($now - 5184000));
        $this->assertStringContainsString('2 years ago', TimeHelper::timeAgo($now - 63072000));
    }

    public function testTimeAgoBoundaryConditions(): void
    {
        $now = time();

        // Just under 1 minute (59 seconds)
        $this->assertEquals('Just now', TimeHelper::timeAgo($now - 59));

        // Exactly 1 minute (60 seconds)
        $this->assertEquals('1 minute ago', TimeHelper::timeAgo($now - 60));

        // Just under 1 hour (3599 seconds)
        $this->assertStringContainsString('minutes ago', TimeHelper::timeAgo($now - 3599));

        // Exactly 1 hour (3600 seconds)
        $this->assertEquals('1 hour ago', TimeHelper::timeAgo($now - 3600));
    }

    public function testTimeAgoWithNumericStringInput(): void
    {
        // Numeric string should be treated as timestamp
        $now = (string)time();
        $oneHourAgo = (string)(time() - 3600);

        $this->assertEquals('Just now', TimeHelper::timeAgo($now));
        $this->assertStringContainsString('hour', TimeHelper::timeAgo($oneHourAgo));
        $this->assertStringContainsString('ago', TimeHelper::timeAgo($oneHourAgo));
    }
}
