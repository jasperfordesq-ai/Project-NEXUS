<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Jobs\ProcessPodcastEpisodeMedia;
use App\Models\PodcastEpisode;
use App\Services\PodcastMediaScanner;
use App\Services\PodcastService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\Laravel\TestCase;

/**
 * Production ran without a virus scanner until 2026-10-21, so every hosted
 * podcast upload was recorded `scan_unavailable` and its Publish button answered
 * 409 for ever: the media job only scans `pending` media, and nothing moved an
 * episode out of `scan_unavailable`. podcasts:rescan-unavailable-media re-queues
 * such episodes once the scanner answers.
 *
 * The scanner is a real TCP server speaking clamd's protocol (PING and
 * INSTREAM), run as a child process, so PodcastMediaScanner is exercised on the
 * wire rather than mocked.
 */
class PodcastRescanUnavailableMediaTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    /** @var resource|null */
    private $fakeClamd = null;

    private int $showId;
    private int $userId;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        Storage::fake('local');

        $this->userId = DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'name' => 'RescanUser',
            'first_name' => 'Rescan',
            'last_name' => 'User',
            'email' => 'rescan.' . uniqid('', true) . '@example.test',
            'status' => 'active',
            'balance' => 0,
            'role' => 'member',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->showId = DB::table('podcast_shows')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'owner_user_id' => $this->userId,
            'title' => 'Rescan Show',
            'slug' => 'rescan-show-' . uniqid('', true),
            'language' => 'en',
            'visibility' => 'public',
            'status' => 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        if (is_resource($this->fakeClamd)) {
            proc_terminate($this->fakeClamd);
            proc_close($this->fakeClamd);
        }
        parent::tearDown();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** Start a clamd stand-in and point the scanner at it. */
    private function startFakeClamd(): void
    {
        $server = <<<'PHP'
$s = stream_socket_server('tcp://127.0.0.1:0', $e, $m);
fwrite(STDOUT, stream_socket_get_name($s, false) . "\n");
fflush(STDOUT);
while ($c = @stream_socket_accept($s, 30)) {
    $cmd = '';
    while (($ch = fread($c, 1)) !== '' && $ch !== false && $ch !== "\0") { $cmd .= $ch; }
    if ($cmd === 'zPING') {
        fwrite($c, "PONG\0");
    } elseif ($cmd === 'zINSTREAM') {
        $body = '';
        while (true) {
            $len = unpack('N', fread($c, 4))[1];
            if ($len === 0) { break; }
            $chunk = '';
            while (strlen($chunk) < $len) { $chunk .= fread($c, $len - strlen($chunk)); }
            $body .= $chunk;
        }
        fwrite($c, str_contains($body, 'EICAR') ? "stream: Eicar-Signature FOUND\0" : "stream: OK\0");
    }
    fclose($c);
}
PHP;

        $this->fakeClamd = proc_open([PHP_BINARY, '-r', $server], [1 => ['pipe', 'w']], $pipes);
        $this->assertIsResource($this->fakeClamd);
        $address = trim((string) fgets($pipes[1]));
        $this->assertMatchesRegularExpression('/^127\.0\.0\.1:\d+$/', $address);

        config(['services.clamav.address' => 'tcp://' . $address]);
    }

    /** Minimal valid PCM WAV, enough for getID3 to call it audio. */
    private static function tinyWavBytes(): string
    {
        $data = str_repeat(pack('v', 8000) . pack('v', 57536), 8000);

        return 'RIFF' . pack('V', 36 + strlen($data)) . 'WAVE'
            . 'fmt ' . pack('V', 16) . pack('v', 1) . pack('v', 1) . pack('V', 8000) . pack('V', 16000) . pack('v', 2) . pack('v', 16)
            . 'data' . pack('V', strlen($data)) . $data;
    }

    /** An episode in the state production left it in: processed, never scanned. */
    private function insertStuckEpisode(array $overrides = []): int
    {
        $path = 'podcasts/' . self::TENANT_ID . '/stuck-' . uniqid('', true) . '.wav';
        Storage::disk('local')->put($path, self::tinyWavBytes());

        return DB::table('podcast_episodes')->insertGetId(array_merge([
            'tenant_id' => self::TENANT_ID,
            'show_id' => $this->showId,
            'author_user_id' => $this->userId,
            'title' => 'Stuck Episode',
            'slug' => 'stuck-ep-' . uniqid('', true),
            'audio_url' => 'https://example.com/audio.wav',
            'audio_storage_disk' => 'local',
            'audio_storage_path' => $path,
            'media_processing_status' => 'complete',
            'media_scan_status' => 'scan_unavailable',
            'status' => 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function scanStatus(int $id): string
    {
        return (string) DB::table('podcast_episodes')->where('id', $id)->value('media_scan_status');
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    public function test_nothing_is_requeued_while_no_scanner_is_configured(): void
    {
        Queue::fake();
        config(['services.clamav.address' => '']);
        $id = $this->insertStuckEpisode();

        $this->assertSame(0, PodcastService::requeueUnavailableMediaScans());

        $this->assertSame('scan_unavailable', $this->scanStatus($id));
        Queue::assertNotPushed(ProcessPodcastEpisodeMedia::class);
    }

    public function test_nothing_is_requeued_while_the_scanner_does_not_answer(): void
    {
        Queue::fake();
        // A closed local port: configured, but down or still loading signatures.
        config(['services.clamav.address' => 'tcp://127.0.0.1:1']);
        $id = $this->insertStuckEpisode();

        $this->assertFalse(PodcastMediaScanner::isReachable());
        $this->assertSame(0, PodcastService::requeueUnavailableMediaScans());
        $this->assertSame('scan_unavailable', $this->scanStatus($id));
        Queue::assertNotPushed(ProcessPodcastEpisodeMedia::class);
    }

    public function test_stuck_episode_is_rescanned_and_can_then_be_published(): void
    {
        $this->startFakeClamd();
        Queue::fake();
        $id = $this->insertStuckEpisode();

        // Before: the exact production failure — publishing is refused.
        try {
            PodcastService::publishEpisode(PodcastEpisode::findOrFail($id));
            $this->fail('An unscanned episode must not publish');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('not ready for publishing', $e->getMessage());
        }

        $this->assertTrue(PodcastMediaScanner::isReachable());
        $this->assertGreaterThanOrEqual(1, PodcastService::requeueUnavailableMediaScans());
        $this->assertSame('pending', $this->scanStatus($id));
        Queue::assertPushed(
            ProcessPodcastEpisodeMedia::class,
            fn (ProcessPodcastEpisodeMedia $job) => $job->episodeId === $id && $job->tenantId === self::TENANT_ID
        );

        (new ProcessPodcastEpisodeMedia(self::TENANT_ID, $id))->handle();
        $this->assertSame('clean', $this->scanStatus($id));

        $published = PodcastService::publishEpisode(PodcastEpisode::findOrFail($id));
        $this->assertSame('published', $published->status);
    }

    public function test_infected_audio_found_on_rescan_is_quarantined_not_published(): void
    {
        $this->startFakeClamd();
        Queue::fake();
        $id = $this->insertStuckEpisode();
        $path = (string) DB::table('podcast_episodes')->where('id', $id)->value('audio_storage_path');
        Storage::disk('local')->put($path, self::tinyWavBytes() . 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE');

        PodcastService::requeueUnavailableMediaScans();
        (new ProcessPodcastEpisodeMedia(self::TENANT_ID, $id))->handle();

        $this->assertSame('infected', $this->scanStatus($id));
        $this->assertSame('draft', DB::table('podcast_episodes')->where('id', $id)->value('status'));
    }

    public function test_media_that_already_failed_processing_is_left_alone(): void
    {
        $this->startFakeClamd();
        Queue::fake();
        $id = $this->insertStuckEpisode([
            'media_processing_status' => 'failed',
            'media_failure_reason' => 'source_missing',
        ]);

        PodcastService::requeueUnavailableMediaScans();

        $this->assertSame('scan_unavailable', $this->scanStatus($id));
        Queue::assertNotPushed(
            ProcessPodcastEpisodeMedia::class,
            fn (ProcessPodcastEpisodeMedia $job) => $job->episodeId === $id
        );
    }

    public function test_rescan_command_is_scheduled_on_one_server_without_overlap(): void
    {
        $source = file_get_contents(base_path('bootstrap/app.php'));
        $this->assertIsString($source);

        $start = strpos($source, 'podcasts:rescan-unavailable-media --limit=50');
        $this->assertNotFalse($start);
        $block = substr($source, $start, 260);

        $this->assertStringContainsString('->everyFifteenMinutes()', $block);
        $this->assertStringContainsString('->withoutOverlapping(30)', $block);
        $this->assertStringContainsString('->onOneServer()', $block);
        $this->assertStringContainsString("->name('podcasts-rescan-unavailable-media')", $block);
    }
}
