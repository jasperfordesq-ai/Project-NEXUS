<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Gives a course lesson somewhere to hold a transcript.
 *
 * Found by the accessible-frontend audit (2026-08-23): a video lesson offered no
 * text alternative at all, which is a WCAG 1.2 failure, and there was nowhere in
 * the schema to put one. `body` exists and is rendered under the video, but it
 * is the lesson's general content — an instructor writing lesson notes there has
 * not thereby written a transcript, and a reader cannot tell which they are
 * looking at. A named column lets both exist and lets the page label the
 * transcript as a transcript.
 *
 * Follows `podcast_episodes.transcript` and `messages.transcript`, which are the
 * two existing precedents for this exact field.
 *
 * `transcript_language` is deliberately NOT added, even though both precedents
 * have it. Theirs supports automatic transcription, which detects a language;
 * this transcript is typed by the instructor in the lesson's own language, so
 * the column would have no consumer. Add it when something needs it.
 *
 * NULL means "no transcript", which is exactly today's behaviour, so every
 * existing lesson keeps working and nothing needs backfilling.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('course_lessons')) {
            return;
        }

        if (Schema::hasColumn('course_lessons', 'transcript')) {
            return;
        }

        Schema::table('course_lessons', function (Blueprint $table): void {
            // longtext, matching podcast_episodes.transcript: a transcript of a
            // long lesson comfortably exceeds TEXT's 64KB.
            $table->longText('transcript')
                ->nullable()
                ->default(null)
                ->after('body')
                ->comment('Text alternative for audio/video lessons; NULL = none provided');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('course_lessons') || ! Schema::hasColumn('course_lessons', 'transcript')) {
            return;
        }

        Schema::table('course_lessons', function (Blueprint $table): void {
            $table->dropColumn('transcript');
        });
    }
};
