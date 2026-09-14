<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Core\ImageUploader;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\PodcastEpisode;
use App\Models\PodcastEpisodeChapter;
use App\Models\PodcastEpisodeListen;
use App\Models\PodcastEpisodeReaction;
use App\Models\PodcastShow;
use App\Models\User;
use App\Jobs\ProcessPodcastEpisodeMedia;
use App\Helpers\UrlHelper;
use Carbon\Carbon;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class PodcastService
{
    private const HOSTED_AUDIO_PLACEHOLDER = 'podcast-hosted://pending';
    private const HOSTED_AUDIO_ROUTE_TTL_SECONDS = 3600;
    private const LISTEN_DEDUPE_WINDOW_HOURS = 6;
    private const REPORT_AUTO_FLAG_THRESHOLD = 3;
    private const TITLE_MAX_LENGTH = 200;
    private const REACTION_MAX_LENGTH = 30;
    private const MAX_CHAPTERS = 200;
    private const ALLOWED_AUDIO_TYPES = [
        'audio/mpeg' => 'mp3',
        'audio/mp3' => 'mp3',
        'audio/mp4' => 'm4a',
        'audio/aac' => 'aac',
        'audio/wav' => 'wav',
        'audio/x-wav' => 'wav',
        'audio/ogg' => 'ogg',
        'audio/webm' => 'webm',
        'video/webm' => 'webm',
    ];

    /**
     * @param array{search?:string,category?:string,sort?:string,page?:int,per_page?:int,include_member_only?:bool} $filters
     * @return array{items:array,total:int,page:int,per_page:int}
     */
    public static function browse(array $filters = []): array
    {
        $page = max(1, (int) ($filters['page'] ?? 1));
        $perPage = min(50, max(1, (int) ($filters['per_page'] ?? 12)));
        $sort = (string) ($filters['sort'] ?? 'newest');

        $query = PodcastShow::query()
            ->published()
            ->with(['owner:id,name,avatar_url'])
            ->withCount(['episodes as approved_episode_count' => fn (Builder $q) => $q->published()->distributionReady()]);

        if (empty($filters['include_member_only'])) {
            $query->where('visibility', 'public');
        } else {
            $query->whereIn('visibility', ['public', 'members']);
        }

        if (!empty($filters['search'])) {
            $term = trim((string) $filters['search']);
            $query->where(function (Builder $q) use ($term) {
                $q->where('title', 'like', "%{$term}%")
                    ->orWhere('summary', 'like', "%{$term}%")
                    ->orWhere('description', 'like', "%{$term}%");
            });
        }

        if (!empty($filters['category'])) {
            $category = trim((string) $filters['category']);
            $query->where('category', $category);
        }

        $total = (clone $query)->count();
        $query = match ($sort) {
            'title' => $query->orderBy('title')->orderByDesc('id'),
            'episodes' => $query->orderByDesc('approved_episode_count')->orderByDesc('published_at')->orderByDesc('id'),
            'followers' => $query->orderByDesc('subscriber_count')->orderByDesc('published_at')->orderByDesc('id'),
            default => $query->orderByDesc('published_at')->orderByDesc('id'),
        };

        $items = $query->forPage($page, $perPage)->get()->toArray();

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    /**
     * Distinct non-empty podcast categories for the current tenant's published
     * shows. Backs the accessible browse category filter (no-JS select). Tenant
     * scope comes from PodcastShow's global scope; published() matches browse().
     *
     * @return array<int,string>
     */
    public static function getDistinctCategories(bool $includeMemberOnly = false): array
    {
        return PodcastShow::query()
            ->published()
            ->whereIn('visibility', $includeMemberOnly ? ['public', 'members'] : ['public'])
            ->whereNotNull('category')
            ->where('category', '!=', '')
            ->distinct()
            ->orderBy('category')
            ->pluck('category')
            ->map(static fn ($c) => (string) $c)
            ->all();
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public static function authoredBy(int $userId): array
    {
        $shows = PodcastShow::where('owner_user_id', $userId)
            ->with([
                'episodes' => fn ($q) => $q->with('chapters'),
            ])
            ->withCount('episodes')
            ->orderByDesc('updated_at')
            ->get();

        $shows->each(function (PodcastShow $show) use ($userId): void {
            $show->makeVisible('owner_email');
            $show->moderation_feedback = $show->moderation_notes;
            $show->episodes->each(function (PodcastEpisode $episode) use ($userId): void {
                $episode->moderation_feedback = $episode->moderation_notes;
                self::prepareEpisodeForResponse($episode, $userId, false);
            });
        });

        return $shows->toArray();
    }

    /**
     * Lightweight count of shows owned by a user — for limit checks without
     * eager-loading every episode/chapter or signing audio URLs (unlike authoredBy()).
     */
    public static function ownedShowCount(int $userId): int
    {
        return PodcastShow::where('owner_user_id', $userId)->count();
    }

    public static function findShowById(int $id): ?PodcastShow
    {
        return PodcastShow::with(['owner:id,name,avatar_url'])->find($id);
    }

    public static function findShowBySlug(string $slug, ?int $userId = null, bool $isAdmin = false): ?PodcastShow
    {
        $show = PodcastShow::where('slug', $slug)
            ->with('owner:id,name,avatar_url')
            ->first();

        if (!$show) {
            return null;
        }

        $show->load([
            'episodes' => fn ($q) => self::visibleEpisodeQuery($q, $show, $userId, $isAdmin)
                ->when(
                    PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_CHAPTERS),
                    fn ($episodeQuery) => $episodeQuery->with('chapters')
                ),
        ]);

        $show->episodes->each(fn (PodcastEpisode $episode) => self::prepareEpisodeForResponse($episode, $userId, $isAdmin));
        if ($userId !== null) {
            $show->is_subscribed = DB::table('podcast_show_subscriptions')
                ->where('tenant_id', TenantContext::getId())
                ->where('show_id', $show->id)
                ->where('user_id', $userId)
                ->exists();
        }

        return $show;
    }

    public static function findEpisodeBySlug(PodcastShow $show, string $slug): ?PodcastEpisode
    {
        $episode = PodcastEpisode::where('show_id', $show->id)
            ->where('slug', $slug)
            ->with(['show.owner:id,name,avatar_url', 'author:id,name,avatar_url', 'chapters'])
            ->first();

        if ($episode) {
            self::applyConfigVisibilityToEpisode($episode);
            self::prepareEpisodeForResponse($episode, null, false);
        }

        return $episode;
    }

    public static function createShow(int $ownerUserId, array $data): PodcastShow
    {
        $title = self::requiredText($data['title'] ?? null, self::TITLE_MAX_LENGTH, 'Podcast title is required');
        $visibility = self::normalizeVisibility((string) ($data['visibility'] ?? 'public'));

        $show = new PodcastShow([
            'title' => $title,
            'slug' => self::uniqueShowSlug((string) ($data['slug'] ?? $title)),
            'summary' => self::nullableText($data['summary'] ?? null, 600),
            'description' => self::nullableText($data['description'] ?? null),
            'artwork_url' => self::nullableArtworkPath($data['artwork_url'] ?? null),
            'language' => self::nullableText($data['language'] ?? 'en', 20) ?: 'en',
            'category' => self::nullableText($data['category'] ?? null, 120),
            'author_name' => self::nullableText($data['author_name'] ?? null, 200),
            'owner_email' => self::nullableEmail($data['owner_email'] ?? null),
            'copyright' => self::nullableText($data['copyright'] ?? null, 300),
            'funding_url' => self::nullableUrl($data['funding_url'] ?? null),
            'explicit' => filter_var($data['explicit'] ?? false, FILTER_VALIDATE_BOOLEAN),
            'visibility' => $visibility,
        ]);

        $show->owner_user_id = $ownerUserId;
        $show->status = 'draft';
        $show->moderation_status = self::moderationEnabled() ? 'pending' : 'approved';
        $show->save();

        return $show;
    }

    public static function updateShow(PodcastShow $show, array $data): PodcastShow
    {
        $wasApproved = $show->moderation_status === 'approved';
        foreach (['title', 'summary', 'description', 'artwork_url', 'language', 'category', 'author_name', 'owner_email', 'copyright', 'funding_url'] as $field) {
            if (array_key_exists($field, $data)) {
                $limit = match ($field) {
                    'summary' => 600,
                    'artwork_url' => 1000,
                    'language' => 20,
                    'category' => 120,
                    'author_name' => 200,
                    'owner_email' => 320,
                    'copyright' => 300,
                    'funding_url' => 1000,
                    default => null,
                };
                if (in_array($field, ['artwork_url', 'funding_url'], true)) {
                    $show->{$field} = $field === 'artwork_url'
                        ? self::nullableArtworkPath($data[$field] ?? null)
                        : self::nullableUrl($data[$field] ?? null);
                } elseif ($field === 'owner_email') {
                    $show->{$field} = self::nullableEmail($data[$field] ?? null);
                } elseif ($field === 'title') {
                    $show->{$field} = self::requiredText($data[$field] ?? null, self::TITLE_MAX_LENGTH, 'Podcast title is required');
                } else {
                    $show->{$field} = self::nullableText($data[$field], $limit);
                }
            }
        }

        if (array_key_exists('explicit', $data)) {
            $show->explicit = filter_var($data['explicit'], FILTER_VALIDATE_BOOLEAN);
        }

        if (array_key_exists('visibility', $data)) {
            $show->visibility = self::normalizeVisibility((string) $data['visibility']);
        }

        $materiallyChanged = $show->isDirty([
            'title', 'summary', 'description', 'artwork_url', 'language',
            'category', 'author_name', 'owner_email', 'copyright',
            'funding_url', 'explicit', 'visibility',
        ]);
        if ($materiallyChanged && $wasApproved && self::moderationEnabled()) {
            $show->moderation_status = 'pending';
            $show->moderation_notes = null;
            $show->moderated_by = null;
            $show->moderated_at = null;
        }

        $show->save();
        self::syncShowFeedActivity($show);

        return $show;
    }

    public static function publishShow(PodcastShow $show): PodcastShow
    {
        $show->status = 'published';
        $show->moderation_status = self::moderationEnabled() ? 'pending' : 'approved';
        if (!$show->published_at) {
            $show->published_at = now();
        }
        $show->save();

        self::syncShowFeedActivity($show);

        return $show;
    }

    public static function createEpisode(PodcastShow $show, int $authorUserId, array $data, ?UploadedFile $audioFile = null): PodcastEpisode
    {
        self::validateChapterPayload($data['chapters'] ?? null);
        $storedMedia = null;

        try {
            return DB::transaction(function () use ($show, $authorUserId, $data, $audioFile, &$storedMedia): PodcastEpisode {
            $title = self::requiredText($data['title'] ?? null, self::TITLE_MAX_LENGTH, 'Podcast episode title is required');
            $hasHostedAudio = $audioFile !== null;
            $episode = new PodcastEpisode([
                'show_id' => $show->id,
                'title' => $title,
                'slug' => self::uniqueEpisodeSlug($show->id, (string) ($data['slug'] ?? $title)),
                'summary' => self::nullableText($data['summary'] ?? null, 600),
                'description' => self::nullableText($data['description'] ?? null),
                'audio_url' => $hasHostedAudio ? self::HOSTED_AUDIO_PLACEHOLDER : self::requiredUrl($data['audio_url'] ?? ''),
                'audio_mime' => $hasHostedAudio ? null : self::nullableText($data['audio_mime'] ?? null, 120),
                'audio_bytes' => $hasHostedAudio ? null : self::normalizeAudioBytes($data['audio_bytes'] ?? null),
                'duration_seconds' => isset($data['duration_seconds']) ? max(0, (int) $data['duration_seconds']) : null,
                'episode_number' => isset($data['episode_number']) ? max(0, (int) $data['episode_number']) : null,
                'season_number' => isset($data['season_number']) ? max(0, (int) $data['season_number']) : null,
                'explicit' => filter_var($data['explicit'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'episode_type' => self::normalizeEpisodeType((string) ($data['episode_type'] ?? 'full')),
                'visibility' => self::normalizeEpisodeVisibility((string) ($data['visibility'] ?? 'inherit')),
                'transcript' => PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_TRANSCRIPTS)
                    ? self::nullableText($data['transcript'] ?? null)
                    : null,
                'transcript_language' => self::nullableText($data['transcript_language'] ?? null, 20),
                'cover_image_url' => self::nullableArtworkPath($data['cover_image_url'] ?? null),
                'scheduled_for' => !empty($data['scheduled_for']) ? Carbon::parse($data['scheduled_for']) : null,
            ]);

            $episode->author_user_id = $authorUserId;
            $episode->status = 'draft';
            $episode->moderation_status = self::moderationEnabled() ? 'pending' : 'approved';
            // Media lifecycle columns are server-controlled (not mass-assignable),
            // so set them explicitly rather than through the fillable constructor.
            $episode->media_processing_status = $hasHostedAudio && PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_MEDIA_PROCESSING) ? 'pending' : 'complete';
            $episode->media_scan_status = $hasHostedAudio && PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_MEDIA_SCANNING) ? 'pending' : 'not_required';
            $episode->save();

            if ($audioFile) {
                self::storeHostedAudio($episode, $audioFile);
                $storedMedia = [$episode->audio_storage_disk ?: 'local', $episode->audio_storage_path];
            }

            self::syncChapters($episode, $data['chapters'] ?? null);
            self::refreshEpisodeCount($show);
            self::prepareEpisodeForResponse($episode, $authorUserId, false);

            return $episode->load('chapters');
            });
        } catch (\Throwable $e) {
            if ($storedMedia && $storedMedia[1]) {
                self::deleteStorageObject((string) $storedMedia[0], (string) $storedMedia[1], false);
            }
            throw $e;
        }
    }

    public static function updateEpisode(PodcastEpisode $episode, array $data, ?UploadedFile $audioFile = null): PodcastEpisode
    {
        self::validateChapterPayload($data['chapters'] ?? null);
        $oldDisk = (string) ($episode->audio_storage_disk ?: 'local');
        $oldPath = $episode->audio_storage_path;
        $oldMedia = self::episodeMediaAttributes($episode);
        $newMedia = null;
        $replacesHostedMedia = $audioFile !== null || array_key_exists('audio_url', $data);

        try {
            $updated = DB::transaction(function () use ($episode, $data, $audioFile, &$newMedia): PodcastEpisode {
                $updated = self::updateEpisodeInTransaction($episode, $data, $audioFile, $newMedia);
                $newMedia ??= [$updated->audio_storage_disk ?: 'local', $updated->audio_storage_path];
                return $updated;
            });
        } catch (\Throwable $e) {
            if ($newMedia && $newMedia[1] && $newMedia[1] !== $oldPath) {
                self::deleteStorageObject((string) $newMedia[0], (string) $newMedia[1], false);
            }
            throw $e;
        }

        if ($replacesHostedMedia && $oldPath && $oldPath !== $updated->audio_storage_path) {
            try {
                // The database now points at the replacement. Only retire the old
                // object after that commit, so a transaction rollback can never
                // leave a surviving row pointing at a file we already deleted.
                self::deleteStorageObject($oldDisk, (string) $oldPath, true);
            } catch (\Throwable $cleanupFailure) {
                try {
                    DB::transaction(function () use ($updated, $oldMedia): void {
                        DB::table('podcast_episodes')
                            ->where('tenant_id', TenantContext::getId())
                            ->where('id', $updated->id)
                            ->update(array_merge($oldMedia, ['updated_at' => now()]));
                    });
                    $updated->refresh();
                    try {
                        self::syncEpisodeFeedActivity($updated);
                    } catch (\Throwable $feedFailure) {
                        Log::warning('Podcast feed reconciliation failed after media compensation', [
                            'episode_id' => $updated->id,
                            'error' => $feedFailure->getMessage(),
                        ]);
                    }
                    if ($newMedia && $newMedia[1] && $newMedia[1] !== $oldPath) {
                        self::deleteStorageObject((string) $newMedia[0], (string) $newMedia[1], false);
                    }
                } catch (\Throwable $compensationFailure) {
                    Log::error('Podcast media replacement compensation failed', [
                        'episode_id' => $updated->id,
                        'cleanup_error' => $cleanupFailure->getMessage(),
                        'compensation_error' => $compensationFailure->getMessage(),
                    ]);
                }

                throw $cleanupFailure;
            }
        }

        if ($audioFile !== null) {
            self::queueMediaProcessing($updated);
        }

        return $updated;
    }

    private static function updateEpisodeInTransaction(PodcastEpisode $episode, array $data, ?UploadedFile $audioFile = null, ?array &$newMedia = null): PodcastEpisode
    {
        $wasApproved = $episode->moderation_status === 'approved';
        foreach ([
            'title', 'summary', 'description', 'audio_url', 'audio_mime',
            'transcript', 'transcript_language', 'cover_image_url',
        ] as $field) {
            if (array_key_exists($field, $data)) {
                $limit = match ($field) {
                    'summary' => 600,
                    'audio_url', 'cover_image_url' => 1000,
                    'audio_mime' => 120,
                    'transcript_language' => 20,
                    default => null,
                };
                if ($field === 'audio_url') {
                    $episode->{$field} = self::requiredUrl($data[$field] ?? '');
                    self::clearHostedAudio($episode);
                } elseif ($field === 'cover_image_url') {
                    $episode->{$field} = self::nullableArtworkPath($data[$field] ?? null);
                } elseif ($field === 'title') {
                    $episode->{$field} = self::requiredText($data[$field] ?? null, self::TITLE_MAX_LENGTH, 'Podcast episode title is required');
                } elseif ($field === 'transcript' && !PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_TRANSCRIPTS)) {
                    $episode->{$field} = null;
                } else {
                    $episode->{$field} = self::nullableText($data[$field], $limit);
                }
            }
        }

        foreach (['audio_bytes', 'duration_seconds', 'episode_number', 'season_number'] as $field) {
            if (array_key_exists($field, $data)) {
                $episode->{$field} = $field === 'audio_bytes'
                    ? self::normalizeAudioBytes($data[$field])
                    : ($data[$field] === null ? null : max(0, (int) $data[$field]));
            }
        }

        if (array_key_exists('explicit', $data)) {
            $episode->explicit = filter_var($data['explicit'], FILTER_VALIDATE_BOOLEAN);
        }
        if (array_key_exists('episode_type', $data)) {
            $episode->episode_type = self::normalizeEpisodeType((string) $data['episode_type']);
        }
        if (array_key_exists('visibility', $data)) {
            $episode->visibility = self::normalizeEpisodeVisibility((string) $data['visibility']);
        }
        if (array_key_exists('scheduled_for', $data)) {
            $episode->scheduled_for = !empty($data['scheduled_for']) ? Carbon::parse($data['scheduled_for']) : null;
        }

        $materiallyChanged = $audioFile !== null
            || array_key_exists('chapters', $data)
            || $episode->isDirty([
                'title', 'summary', 'description', 'audio_url', 'audio_mime',
                'audio_bytes', 'duration_seconds', 'episode_number', 'season_number',
                'explicit', 'episode_type', 'visibility', 'transcript',
                'transcript_language', 'cover_image_url', 'scheduled_for',
            ]);
        if ($materiallyChanged && $wasApproved && self::moderationEnabled()) {
            $episode->moderation_status = 'pending';
            $episode->moderation_notes = null;
            $episode->moderated_by = null;
            $episode->moderated_at = null;
        }

        $episode->save();
        if ($audioFile) {
            self::replaceHostedAudio($episode, $audioFile);
            $newMedia = [$episode->audio_storage_disk ?: 'local', $episode->audio_storage_path];
        }
        self::syncChapters($episode, $data['chapters'] ?? null);
        self::syncEpisodeFeedActivity($episode);
        self::prepareEpisodeForResponse($episode, (int) $episode->author_user_id, false);

        return $episode->load('chapters');
    }

    public static function publishEpisode(PodcastEpisode $episode): PodcastEpisode
    {
        if (!self::isMediaReadyForDistribution($episode)) {
            throw new \InvalidArgumentException('Podcast media is not ready for publishing');
        }

        $wasPublished = $episode->status === 'published';
        $episode->status = 'published';
        $episode->moderation_status = self::moderationEnabled() ? 'pending' : 'approved';
        if (!$episode->published_at) {
            $episode->published_at = $episode->scheduled_for && $episode->scheduled_for->isFuture()
                ? $episode->scheduled_for
                : now();
        }
        $episode->save();

        self::refreshEpisodeCount($episode->show);
        // Announce (notify subscribers + post to the feed) only once the episode is
        // actually live. A future-scheduled episode is left un-announced here and
        // picked up by `podcasts:release-due` when its scheduled_for arrives, so
        // subscribers are never notified about an episode they can't open yet.
        if (!$wasPublished && self::isEpisodeLive($episode)) {
            self::announceEpisode($episode);
        } else {
            self::syncEpisodeFeedActivity($episode);
        }

        self::prepareEpisodeForResponse($episode, (int) $episode->author_user_id, false);

        return $episode->load('chapters');
    }

    /**
     * Is this episode live right now? (published + approved + past any scheduled_for
     * embargo). Decides whether subscribers should be notified immediately.
     */
    private static function isEpisodeLive(PodcastEpisode $episode): bool
    {
        if ($episode->status !== 'published' || $episode->moderation_status !== 'approved') {
            return false;
        }
        $show = $episode->show ?: PodcastShow::find($episode->show_id);
        if (!$show || $show->status !== 'published' || $show->moderation_status !== 'approved') {
            return false;
        }
        if (!self::isMediaReadyForDistribution($episode)) {
            return false;
        }
        if ($episode->scheduled_for && $episode->scheduled_for->isFuture()) {
            return false;
        }

        return $episode->published_at === null || $episode->published_at <= now();
    }

    /**
     * Announce an episode going live — post the feed activity and notify subscribers,
     * exactly once. `announced_at` is claimed with a conditional UPDATE so the publish
     * path, the moderation-approval path, and the `podcasts:release-due` scheduler can
     * never double-post for the same episode.
     */
    private static function announceEpisode(PodcastEpisode $episode): void
    {
        $claimed = PodcastEpisode::whereKey($episode->id)
            ->whereNull('announced_at')
            ->update(['announced_at' => now()]);
        if ($claimed === 0) {
            self::syncEpisodeFeedActivity($episode);
            return; // already notified; still refresh denormalized feed metadata
        }
        $episode->announced_at = now();

        self::syncEpisodeFeedActivity($episode);
        self::notifySubscribersOfEpisode($episode);
    }

    /**
     * Announce every episode whose scheduled publish time has arrived but which has
     * not been announced yet. Runs cross-tenant from the `podcasts:release-due`
     * scheduler (no ambient tenant), setting tenant context per episode — mirroring
     * GroupScheduledPostService::publishDue().
     */
    public static function releaseDueEpisodes(int $limit = 200): int
    {
        $due = PodcastEpisode::withoutGlobalScopes()
            ->where('status', 'published')
            ->where('moderation_status', 'approved')
            ->whereNull('announced_at')
            ->whereNotNull('scheduled_for')
            ->where('scheduled_for', '<=', now())
            ->orderBy('scheduled_for')
            ->limit(max(1, $limit))
            ->get();

        $released = 0;
        foreach ($due as $episode) {
            try {
                $didRelease = TenantContext::runForTenant((int) $episode->tenant_id, function () use ($episode): bool {
                    if (!self::isEpisodeLive($episode)) {
                        return false;
                    }
                    self::announceEpisode($episode);
                    return true;
                });
                if ($didRelease) {
                    $released++;
                }
            } catch (\Throwable $e) {
                Log::warning('[PodcastService] scheduled episode release failed', [
                    'episode_id' => $episode->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $released;
    }

    public static function storeHostedAudio(PodcastEpisode $episode, UploadedFile $file, bool $dispatchProcessing = true): PodcastEpisode
    {
        if (!$file->isValid()) {
            if (in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                throw new \InvalidArgumentException('Podcast audio file is too large');
            }
            throw new \InvalidArgumentException('Podcast media storage failed');
        }

        $mime = (string) $file->getMimeType();
        if (!array_key_exists($mime, self::ALLOWED_AUDIO_TYPES)) {
            throw new \InvalidArgumentException('Unsupported podcast media type');
        }

        self::normalizeAudioBytes($file->getSize());

        $disk = self::mediaStorageDisk();
        $path = sprintf(
            'podcasts/%d/shows/%d/episodes/%d/audio_%s.%s',
            TenantContext::getId(),
            $episode->show_id,
            $episode->id,
            bin2hex(random_bytes(12)),
            self::ALLOWED_AUDIO_TYPES[$mime]
        );

        $stream = fopen($file->getRealPath(), 'rb');
        if (!$stream || !Storage::disk($disk)->put($path, $stream)) {
            if (is_resource($stream)) {
                fclose($stream);
            }
            throw new \InvalidArgumentException('Podcast media storage failed');
        }
        if (is_resource($stream)) {
            fclose($stream);
        }

        $episode->audio_storage_disk = $disk;
        $episode->audio_storage_path = $path;
        $episode->audio_mime = $mime;
        $episode->audio_bytes = $file->getSize();
        $episode->media_processing_status = PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_MEDIA_PROCESSING) ? 'pending' : 'complete';
        $episode->media_scan_status = PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_MEDIA_SCANNING) ? 'pending' : 'not_required';
        // Persist the non-capability proxy URL. Response projection may expose
        // the CDN only after media is ready and publicly distributable.
        $episode->audio_url = self::hostedAudioProxyUrl($episode);
        try {
            $episode->save();
        } catch (\Throwable $e) {
            self::deleteStorageObject($disk, $path, false);
            throw $e;
        }

        if ($dispatchProcessing) {
            self::queueMediaProcessing($episode);
        }

        return $episode;
    }

    public static function episodeAudioUrl(PodcastEpisode $episode, bool $signed = true): string
    {
        $tenantId = (int) ($episode->tenant_id ?: TenantContext::getId());
        $base = self::hostedAudioProxyUrl($episode);
        if (($episode->audio_storage_disk ?? 'local') !== 'local') {
            if ($signed) {
                $expires = time() + self::HOSTED_AUDIO_ROUTE_TTL_SECONDS;
                return $base . '?expires=' . $expires . '&signature=' . self::mediaSignature($tenantId, $episode->id, $expires);
            }

            // A misconfigured / uninstalled cloud disk driver (e.g. the `s3`
            // disk without league/flysystem-aws-s3-v3 installed) makes
            // Storage::disk(...)->url() throw a fatal "Class not found". An
            // unresolvable media URL must never 500 the request — fall back to
            // the in-app media proxy, which always works regardless of disk.
            try {
                return self::cloudMediaUrl((string) $episode->audio_storage_path);
            } catch (\Throwable $e) {
                Log::warning('Podcast cloud media URL resolution failed; using media proxy fallback', [
                    'episode_id' => (int) $episode->id,
                    'disk'       => $episode->audio_storage_disk ?? null,
                    'error'      => $e->getMessage(),
                ]);

                return $base;
            }
        }
        if (!$signed) {
            return $base;
        }

        $expires = time() + self::HOSTED_AUDIO_ROUTE_TTL_SECONDS;
        return $base . '?expires=' . $expires . '&signature=' . self::mediaSignature($tenantId, $episode->id, $expires);
    }

    private static function hostedAudioProxyUrl(PodcastEpisode $episode): string
    {
        $tenantId = (int) ($episode->tenant_id ?: TenantContext::getId());

        return self::apiUrl('/api/v2/podcasts/media/' . $tenantId . '/' . $episode->id . '/audio');
    }

    public static function hasValidMediaSignature(PodcastEpisode $episode, int $tenantId, ?string $expires, ?string $signature): bool
    {
        if (!$expires || !$signature || !ctype_digit($expires) || (int) $expires < time()) {
            return false;
        }

        return (int) $episode->tenant_id === $tenantId
            && hash_equals(self::mediaSignature($tenantId, $episode->id, (int) $expires), $signature);
    }

    public static function isMediaReadyForDistribution(PodcastEpisode $episode): bool
    {
        // External enclosures do not pass through the hosted-media pipeline.
        if (!$episode->audio_storage_path) {
            $audioUrl = (string) $episode->audio_url;
            if ($audioUrl === self::HOSTED_AUDIO_PLACEHOLDER || str_contains($audioUrl, '/api/v2/podcasts/media/')) {
                return false;
            }

            return self::isPodcastMediaUrl($audioUrl);
        }

        return $episode->media_processing_status === 'complete'
            && in_array($episode->media_scan_status, ['clean', 'not_required'], true);
    }

    public static function reconcileMediaLifecycle(PodcastEpisode $episode): void
    {
        $episode->loadMissing('show');
        if (self::isEpisodeLive($episode)) {
            self::announceEpisode($episode);
        } else {
            self::syncEpisodeFeedActivity($episode);
        }
        if ($episode->show) {
            self::refreshEpisodeCount($episode->show);
        }
    }

    public static function mediaPath(PodcastEpisode $episode): ?string
    {
        if (!$episode->audio_storage_path || ($episode->audio_storage_disk ?? 'local') !== 'local') {
            return null;
        }

        return Storage::disk('local')->path($episode->audio_storage_path);
    }

    public static function cloudAccessUrl(PodcastEpisode $episode): ?string
    {
        $path = (string) $episode->audio_storage_path;
        $disk = (string) ($episode->audio_storage_disk ?? 'local');
        if ($path === '' || $disk === 'local') {
            return null;
        }

        $storage = Storage::disk($disk);
        if (method_exists($storage, 'temporaryUrl')) {
            try {
                return $storage->temporaryUrl($path, now()->addMinutes(10));
            } catch (\Throwable $e) {
                Log::warning('Podcast cloud temporary URL generation failed', [
                    'episode_id' => $episode->id,
                    'disk' => $disk,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::warning('Podcast cloud temporary URL is unavailable; refusing private cloud media redirect', [
            'episode_id' => $episode->id,
            'disk' => $disk,
        ]);

        return null;
    }

    public static function archiveShow(PodcastShow $show): PodcastShow
    {
        $show->status = 'archived';
        $show->save();
        self::syncShowFeedActivity($show);

        return $show;
    }

    public static function archiveEpisode(PodcastEpisode $episode): PodcastEpisode
    {
        $episode->status = 'archived';
        $episode->save();
        self::syncEpisodeFeedActivity($episode);
        self::refreshEpisodeCount($episode->show);

        return $episode->load('chapters');
    }

    public static function deleteShow(PodcastShow $show): void
    {
        $episodes = PodcastEpisode::where('show_id', $show->id)->get();
        $cleanup = $episodes->map(fn (PodcastEpisode $episode): array => [
            'disk' => (string) ($episode->audio_storage_disk ?: 'local'),
            'path' => $episode->audio_storage_path,
            'image' => $episode->getRawOriginal('cover_image_url'),
        ])->all();
        $showArtwork = $show->getRawOriginal('artwork_url');

        DB::transaction(function () use ($show, $episodes, $cleanup, $showArtwork): void {
            $mediaCleanup = app(PodcastMediaCleanupService::class);
            foreach ($cleanup as $item) {
                if ($item['path']) {
                    $mediaCleanup->enqueueStorageObject(
                        (string) $item['disk'],
                        (string) $item['path'],
                        'show_deleted',
                    );
                }
                if (is_string($item['image'])) {
                    $mediaCleanup->enqueuePodcastImage($item['image'], 'show_deleted');
                }
            }
            if (is_string($showArtwork)) {
                $mediaCleanup->enqueuePodcastImage($showArtwork, 'show_deleted');
            }

            $episodes->each(fn (PodcastEpisode $episode) => self::deleteEpisodeRecords($episode));
            DB::table('podcast_show_subscriptions')
                ->where('tenant_id', TenantContext::getId())
                ->where('show_id', $show->id)
                ->delete();
            self::removeShowFeedActivities($show);
            $show->delete();
        });
    }

    public static function deleteEpisode(PodcastEpisode $episode, bool $refreshShow = true): void
    {
        $disk = (string) ($episode->audio_storage_disk ?: 'local');
        $path = $episode->audio_storage_path;
        $coverImage = $episode->getRawOriginal('cover_image_url');

        DB::transaction(function () use ($episode, $refreshShow, $disk, $path, $coverImage): void {
            $mediaCleanup = app(PodcastMediaCleanupService::class);
            if ($path) {
                $mediaCleanup->enqueueStorageObject($disk, (string) $path, 'episode_deleted');
            }
            if (is_string($coverImage)) {
                $mediaCleanup->enqueuePodcastImage($coverImage, 'episode_deleted');
            }

            $show = $episode->show;
            self::deleteEpisodeRecords($episode);

            if ($refreshShow && $show) {
                self::refreshEpisodeCount($show);
            }
        });
    }

    public static function moderateShow(PodcastShow $show, int $adminId, string $action, ?string $notes): PodcastShow
    {
        $show->moderation_status = self::moderationActionToStatus($action);
        $show->moderation_notes = $notes;
        $show->moderated_by = $adminId;
        $show->moderated_at = now();
        if ($action === 'reject') {
            $show->status = 'draft';
        }
        $show->save();

        self::syncShowFeedActivity($show);

        return $show;
    }

    public static function moderateEpisode(PodcastEpisode $episode, int $adminId, string $action, ?string $notes): PodcastEpisode
    {
        if ($action === 'approve' && !self::isMediaReadyForDistribution($episode)) {
            throw new \InvalidArgumentException('Podcast media is not ready for publishing');
        }
        $episode->moderation_status = self::moderationActionToStatus($action);
        $episode->moderation_notes = $notes;
        $episode->moderated_by = $adminId;
        $episode->moderated_at = now();
        if ($action === 'reject') {
            $episode->status = 'draft';
        }
        $episode->save();
        self::syncEpisodeFeedActivity($episode);
        self::refreshEpisodeCount($episode->show);

        // Announce on approval, but only if the episode is actually live now. If it
        // is still future-scheduled, `podcasts:release-due` announces it when due.
        if ($action === 'approve' && self::isEpisodeLive($episode)) {
            self::announceEpisode($episode);
        }

        return $episode;
    }

    public static function recordListen(PodcastEpisode $episode, ?int $userId, array $data, ?string $userAgent, ?string $ip): void
    {
        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_LISTEN_ANALYTICS)) {
            return;
        }

        // Authenticated listeners are deduplicated by their stable tenant user
        // identity. Client-controlled session IDs are anonymous-only.
        $sessionHash = $userId === null && !empty($data['session_id'])
            ? self::privateHash((string) $data['session_id'])
            : null;
        $userAgentHash = $userAgent ? self::privateHash($userAgent) : null;
        $ipHash = $ip ? self::privateHash($ip) : null;
        $listenedSeconds = max(0, (int) ($data['listened_seconds'] ?? 0));
        // Clamp to the known episode duration so a client cannot inflate retention /
        // completion analytics by posting an arbitrarily large listened_seconds value.
        $durationCeiling = (int) ($episode->duration_seconds ?? 0);
        if ($durationCeiling > 0 && $listenedSeconds > $durationCeiling) {
            $listenedSeconds = $durationCeiling;
        }
        // Completion is server-derived from trusted episode duration; a client
        // cannot inflate completion metrics by posting completed=true.
        $completed = $durationCeiling > 0
            && $listenedSeconds >= (int) ceil($durationCeiling * 0.95);

        // Serialize concurrent listen pings per LISTENER (not per episode — a
        // row lock on the episode made every listener queue behind every
        // other) so the dedupe read-modify-write cannot double-insert or
        // double-increment. On lock timeout we record anyway: one duplicate
        // analytics row beats dropping the listen.
        $identity = $sessionHash
            ?? ($userId !== null ? 'u' . $userId : 'a' . md5(($userAgentHash ?? '') . '|' . ($ipHash ?? '')));
        $lock = Cache::lock('podcast_listen:' . $episode->id . ':' . $identity, 5);

        $record = static function () use ($episode, $userId, $userAgent, $sessionHash, $userAgentHash, $ipHash, $listenedSeconds, $completed): void {
            DB::transaction(function () use ($episode, $userId, $userAgent, $sessionHash, $userAgentHash, $ipHash, $listenedSeconds, $completed): void {
                $existing = self::findRecentListen($episode, $userId, $sessionHash, $userAgentHash, $ipHash);
                if ($existing) {
                    $existing->listened_seconds = max((int) $existing->listened_seconds, $listenedSeconds);
                    $existing->completed = (bool) $existing->completed || $completed;
                    $existing->client_family = $existing->client_family ?: self::clientFamily($userAgent);
                    $existing->retention_bucket = self::retentionBucket($episode, (int) $existing->listened_seconds);
                    $existing->user_agent_hash = $existing->user_agent_hash ?: $userAgentHash;
                    $existing->ip_hash = $existing->ip_hash ?: $ipHash;
                    $existing->save();
                    return;
                }

                PodcastEpisodeListen::create([
                    'episode_id' => $episode->id,
                    'user_id' => $userId,
                    'session_hash' => $sessionHash,
                    'listened_seconds' => $listenedSeconds,
                    'completed' => $completed,
                    'client_family' => self::clientFamily($userAgent),
                    'retention_bucket' => self::retentionBucket($episode, $listenedSeconds),
                    'user_agent_hash' => $userAgentHash,
                    'ip_hash' => $ipHash,
                    'created_at' => now(),
                ]);

                $episode->increment('listen_count');
            });
        };

        try {
            $lock->block(2, $record);
        } catch (LockTimeoutException) {
            $record();
        }
    }

    public static function toggleReaction(PodcastEpisode $episode, int $userId, string $reaction = 'like', ?bool $desiredActive = null): bool
    {
        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_EPISODE_REACTIONS)) {
            return false;
        }

        return DB::transaction(function () use ($episode, $userId, $reaction, $desiredActive): bool {
            $reaction = self::normalizeReaction($reaction);
            PodcastEpisode::whereKey($episode->id)->lockForUpdate()->first();
            $existing = PodcastEpisodeReaction::where('episode_id', $episode->id)
                ->where('user_id', $userId)
                ->where('reaction', $reaction)
                ->first();

            $targetActive = $desiredActive ?? ! $existing;
            if (! $targetActive) {
                if ($existing) {
                    $existing->delete();
                }
                return false;
            }
            if ($existing) {
                return true;
            }

            $authorUserId = (int) $episode->author_user_id;
            if ($authorUserId > 0 && $authorUserId !== $userId) {
                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId,
                    $authorUserId,
                    TenantContext::getId(),
                    'podcast_episode_reaction',
                );
            }

            PodcastEpisodeReaction::create([
                'episode_id' => $episode->id,
                'user_id' => $userId,
                'reaction' => $reaction,
            ]);

            return true;
        });
    }

    public static function toggleSubscription(PodcastShow $show, int $userId, bool $notifyNewEpisodes = true, ?bool $desiredSubscribed = null): bool
    {
        return DB::transaction(function () use ($show, $userId, $notifyNewEpisodes, $desiredSubscribed): bool {
            $tenantId = TenantContext::getId();
            // Lock the show row so concurrent subscribe/unsubscribe toggles can't
            // race the recount into a stale subscriber_count.
            PodcastShow::whereKey($show->id)->lockForUpdate()->first();

            $existing = DB::table('podcast_show_subscriptions')
                ->where('tenant_id', $tenantId)
                ->where('show_id', $show->id)
                ->where('user_id', $userId)
                ->first();

            $targetSubscribed = $desiredSubscribed ?? ! $existing;
            if (! $targetSubscribed) {
                if (! $existing) {
                    return false;
                }
                DB::table('podcast_show_subscriptions')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $existing->id)
                    ->delete();
                self::refreshSubscriberCount($show);
                return false;
            }
            if ($existing) {
                return true;
            }

            DB::table('podcast_show_subscriptions')->insert([
                'tenant_id' => $tenantId,
                'show_id' => $show->id,
                'user_id' => $userId,
                'notify_new_episodes' => $notifyNewEpisodes,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            self::refreshSubscriberCount($show);

            return true;
        });
    }

    public static function reportEpisode(PodcastEpisode $episode, int $userId, string $reason, ?string $details): array
    {
        $tenantId = TenantContext::getId();
        $existing = DB::table('podcast_episode_reports')
            ->where('tenant_id', $tenantId)
            ->where('episode_id', $episode->id)
            ->where('reporter_user_id', $userId)
            ->where('status', 'open')
            ->first();

        if ($existing) {
            DB::table('podcast_episode_reports')
                ->where('tenant_id', $tenantId)
                ->where('id', $existing->id)
                ->update([
                    'reason' => self::nullableText($reason, 80) ?: 'other',
                    'details' => self::nullableText($details, 2000),
                    'updated_at' => now(),
                ]);

            $reportId = (int) $existing->id;
        } else {
            $reportId = (int) DB::table('podcast_episode_reports')->insertGetId([
                'tenant_id' => $tenantId,
                'episode_id' => $episode->id,
                'reporter_user_id' => $userId,
                'reason' => self::nullableText($reason, 80) ?: 'other',
                'details' => self::nullableText($details, 2000),
                'status' => 'open',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        self::maybeFlagEpisodeFromReports($episode);

        $report = DB::table('podcast_episode_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first();

        return [
            'id' => (int) $report->id,
            'episode_id' => (int) $report->episode_id,
            'reason' => (string) $report->reason,
            'details' => $report->details,
            'status' => (string) $report->status,
            'created_at' => $report->created_at,
        ];
    }

    /**
     * Auto-hide a published episode only when moderation is enabled (admins
     * actively triage) or enough distinct members have independently reported
     * it. A single report must never remove a creator's episode from public /
     * RSS / feed visibility — otherwise one bad actor can grief any creator.
     */
    private static function maybeFlagEpisodeFromReports(PodcastEpisode $episode): void
    {
        if ($episode->moderation_status !== 'approved') {
            return;
        }

        if (self::moderationEnabled()) {
            $episode->moderation_status = 'flagged';
            $episode->save();
            self::syncEpisodeFeedActivity($episode);
            return;
        }

        $distinctReporters = (int) DB::table('podcast_episode_reports')
            ->where('tenant_id', TenantContext::getId())
            ->where('episode_id', $episode->id)
            ->where('status', 'open')
            ->distinct()
            ->count('reporter_user_id');

        if ($distinctReporters >= self::REPORT_AUTO_FLAG_THRESHOLD) {
            $episode->moderation_status = 'flagged';
            $episode->save();
            self::syncEpisodeFeedActivity($episode);
        }
    }

    public static function resolveEpisodeReport(int $reportId, int $adminId, string $status): ?array
    {
        if (!in_array($status, ['resolved', 'dismissed', 'escalated'], true)) {
            throw new \InvalidArgumentException('Invalid podcast report status');
        }

        $tenantId = TenantContext::getId();
        $report = DB::table('podcast_episode_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first();
        if (!$report) {
            return null;
        }

        DB::table('podcast_episode_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->where('status', 'open')
            ->update([
                'status' => $status,
                'reviewed_by' => $adminId,
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);

        $episode = PodcastEpisode::find((int) $report->episode_id);
        $openReports = DB::table('podcast_episode_reports')
            ->where('tenant_id', $tenantId)
            ->where('episode_id', (int) $report->episode_id)
            ->where('status', 'open')
            ->count();

        // Restore an auto-flag only after the final open report has been
        // individually reviewed. Escalation deliberately keeps it hidden.
        if ($episode && $openReports === 0 && in_array($status, ['resolved', 'dismissed'], true) && $episode->moderation_status === 'flagged') {
            $episode->moderation_status = 'approved';
            $episode->moderated_by = $adminId;
            $episode->moderated_at = now();
            $episode->save();
            self::syncEpisodeFeedActivity($episode);
        }

        return [
            'report_id' => $reportId,
            'episode_id' => (int) $report->episode_id,
            'open_reports' => $openReports,
        ];
    }

    /**
     * @return array{shows:array,episodes:array,totals:array{shows:int,episodes:int},stats:array,top_episodes:array,reports:array,client_breakdown:array,retention:array}
     */
    public static function adminIndex(
        ?string $moderationStatus = null,
        int $showsPage = 1,
        int $episodesPage = 1,
        int $perPage = 200,
        ?string $search = null
    ): array
    {
        $showQuery = PodcastShow::with('owner:id,name')->orderByDesc('created_at');
        $episodeQuery = PodcastEpisode::with(['show:id,title,slug,visibility,status,moderation_status', 'author:id,name', 'chapters'])->orderByDesc('created_at');

        if ($moderationStatus) {
            $showQuery->where('moderation_status', $moderationStatus);
            $episodeQuery->where('moderation_status', $moderationStatus);
        }

        $search = trim((string) $search);
        if ($search !== '') {
            $search = mb_substr($search, 0, 200);
            $like = '%' . $search . '%';
            $showQuery->where(function (Builder $query) use ($like): void {
                $query->where('title', 'like', $like)
                    ->orWhere('summary', 'like', $like)
                    ->orWhere('description', 'like', $like)
                    ->orWhere('category', 'like', $like)
                    ->orWhereHas('owner', fn (Builder $owner) => $owner->where('name', 'like', $like));
            });
            $episodeQuery->where(function (Builder $query) use ($like): void {
                $query->where('title', 'like', $like)
                    ->orWhere('summary', 'like', $like)
                    ->orWhere('description', 'like', $like)
                    ->orWhere('transcript', 'like', $like)
                    ->orWhereHas('show', fn (Builder $show) => $show->where('title', 'like', $like))
                    ->orWhereHas('author', fn (Builder $author) => $author->where('name', 'like', $like));
            });
        }

        $showsPage = max(1, $showsPage);
        $episodesPage = max(1, $episodesPage);
        $perPage = max(1, min(200, $perPage));
        $shows = (clone $showQuery)->forPage($showsPage, $perPage)->get();
        $shows->each(fn (PodcastShow $show) => $show->makeVisible(['owner_email', 'moderation_notes', 'moderated_by', 'moderated_at']));
        $episodes = (clone $episodeQuery)->forPage($episodesPage, $perPage)->get();
        $reportHistory = DB::table('podcast_episode_reports as reports')
            ->leftJoin('users as reporter', 'reporter.id', '=', 'reports.reporter_user_id')
            ->where('reports.tenant_id', TenantContext::getId())
            ->whereIn('reports.episode_id', $episodes->pluck('id'))
            ->orderByDesc('reports.created_at')
            ->select([
                'reports.id', 'reports.episode_id', 'reports.reporter_user_id', 'reports.reason', 'reports.details',
                'reports.status', 'reports.reviewed_by', 'reports.reviewed_at',
                'reports.created_at', 'reporter.name as reporter_name',
            ])
            ->get()
            ->groupBy('episode_id');
        $episodes->each(function (PodcastEpisode $episode) use ($reportHistory): void {
            self::prepareEpisodeForResponse($episode, null, true);
            $episode->makeVisible(['moderation_notes', 'moderated_by', 'moderated_at']);
            $episode->report_history = collect($reportHistory->get($episode->id, collect()))
                ->take(20)
                ->map(fn ($report) => (array) $report)
                ->values()
                ->all();
        });

        return [
            'shows' => $shows->toArray(),
            'episodes' => $episodes->toArray(),
            'totals' => [
                'shows' => (clone $showQuery)->count(),
                'episodes' => (clone $episodeQuery)->count(),
            ],
            'stats' => [
                'total_shows' => PodcastShow::count(),
                'published_shows' => PodcastShow::where('status', 'published')->count(),
                'rss_ready_shows' => self::rssReadyShowCount(),
                'pending_shows' => PodcastShow::where('moderation_status', 'pending')->count(),
                'total_episodes' => PodcastEpisode::count(),
                'published_episodes' => PodcastEpisode::where('status', 'published')->count(),
                'pending_episodes' => PodcastEpisode::where('moderation_status', 'pending')->count(),
                'total_listens' => PodcastEpisodeListen::count(),
                'completed_listens' => PodcastEpisodeListen::where('completed', true)->count(),
                'completion_rate' => self::completionRate(),
                'unique_listeners' => self::uniqueListeners(),
                'open_reports' => DB::table('podcast_episode_reports')
                    ->where('tenant_id', TenantContext::getId())
                    ->where('status', 'open')
                    ->count(),
                'subscribers' => DB::table('podcast_show_subscriptions')
                    ->where('tenant_id', TenantContext::getId())
                    ->count(),
                'pending_media_scans' => PodcastEpisode::where('media_scan_status', 'pending')->count(),
                'media_scan_unavailable' => PodcastEpisode::where('media_scan_status', 'scan_unavailable')->count(),
                'pending_media_processing' => PodcastEpisode::whereIn('media_processing_status', ['pending', 'ready_for_processing'])->count(),
                'failed_media_processing' => PodcastEpisode::where('media_processing_status', 'failed')->count(),
                'infected_media' => PodcastEpisode::where('media_scan_status', 'infected')->count(),
            ],
            'top_episodes' => self::topEpisodes(),
            'reports' => self::openReports($search !== '' ? $search : null),
            'client_breakdown' => self::clientBreakdown(),
            'retention' => self::retentionBreakdown(),
        ];
    }

    public static function validateFeed(PodcastShow $show): array
    {
        $errors = [];
        $warnings = [];

        if ($show->visibility !== 'public' || $show->status !== 'published' || $show->moderation_status !== 'approved') {
            $errors[] = 'show_not_public';
        }
        foreach (['title', 'description', 'language'] as $field) {
            if (empty($show->{$field}) && ($field !== 'description' || empty($show->summary))) {
                $warnings[] = "missing_{$field}";
            }
        }
        if (empty($show->artwork_url)) {
            $warnings[] = 'missing_artwork';
        }

        $episodes = PodcastEpisode::where('show_id', $show->id)->published()->whereIn('visibility', ['inherit', 'public'])->get();
        if ($episodes->isEmpty()) {
            $errors[] = 'missing_public_episodes';
        }
        $skipped = 0;
        foreach ($episodes as $episode) {
            if (!self::isMediaReadyForDistribution($episode)) {
                $errors[] = "episode_{$episode->id}_media_not_ready";
                $skipped++;
                continue;
            }
            $audioUrl = $episode->audio_storage_path ? self::episodeAudioUrl($episode, false) : (string) $episode->audio_url;
            if (!self::isPodcastMediaUrl($audioUrl)) {
                $errors[] = "episode_{$episode->id}_missing_audio_url";
                $skipped++;
            }
            if (empty($episode->audio_bytes)) {
                $warnings[] = "episode_{$episode->id}_missing_audio_length";
            }
            if (empty($episode->audio_mime)) {
                $warnings[] = "episode_{$episode->id}_missing_audio_mime";
            }
        }

        return [
            'valid' => $errors === [],
            'errors' => array_values(array_unique($errors)),
            'warnings' => array_values(array_unique($warnings)),
            // Episodes buildRss() would silently omit from the feed.
            'skipped_episode_count' => $skipped,
        ];
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private static function topEpisodes(?int $showId = null): array
    {
        return PodcastEpisode::with(['show:id,title,slug'])
            ->when($showId !== null, fn ($q) => $q->where('show_id', $showId))
            ->where('listen_count', '>', 0)
            ->orderByDesc('listen_count')
            ->limit(10)
            ->get(['id', 'show_id', 'title', 'slug', 'listen_count'])
            ->toArray();
    }

    /** Constrain a listens query to a single show (listens carry no show_id). */
    private static function scopeListensToShow($query, ?int $showId)
    {
        return $query->when(
            $showId !== null,
            fn ($q) => $q->whereIn('episode_id', PodcastEpisode::where('show_id', $showId)->select('id'))
        );
    }

    private static function openReports(?string $search = null): array
    {
        $query = DB::table('podcast_episode_reports as reports')
            ->leftJoin('podcast_episodes as episodes', function ($join): void {
                $join->on('episodes.id', '=', 'reports.episode_id')
                    ->where('episodes.tenant_id', TenantContext::getId());
            })
            ->leftJoin('podcast_shows as shows', function ($join): void {
                $join->on('shows.id', '=', 'episodes.show_id')
                    ->where('shows.tenant_id', TenantContext::getId());
            })
            ->leftJoin('users as reporter', 'reporter.id', '=', 'reports.reporter_user_id')
            ->where('reports.tenant_id', TenantContext::getId())
            ->where('reports.status', 'open');

        if ($search !== null && $search !== '') {
            $like = '%' . mb_substr(trim($search), 0, 200) . '%';
            $query->where(function ($searchQuery) use ($like): void {
                $searchQuery->where('reports.reason', 'like', $like)
                    ->orWhere('reports.details', 'like', $like)
                    ->orWhere('episodes.title', 'like', $like)
                    ->orWhere('shows.title', 'like', $like)
                    ->orWhere('reporter.name', 'like', $like);
            });
        }

        return $query
            ->orderByDesc('reports.created_at')
            ->limit(50)
            ->select([
                'reports.*',
                'episodes.title as episode_title',
                'episodes.slug as episode_slug',
                'shows.title as show_title',
                'shows.slug as show_slug',
                'reporter.name as reporter_name',
            ])
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    private static function clientBreakdown(?int $showId = null): array
    {
        return self::scopeListensToShow(PodcastEpisodeListen::query(), $showId)
            ->select('client_family', DB::raw('COUNT(*) as listens'))
            ->whereNotNull('client_family')
            ->groupBy('client_family')
            ->orderByDesc('listens')
            ->orderBy('client_family')
            ->get()
            ->map(fn ($row) => [
                'client' => $row->client_family,
                'listens' => (int) $row->listens,
            ])
            ->all();
    }

    private static function retentionBreakdown(?int $showId = null): array
    {
        return self::scopeListensToShow(PodcastEpisodeListen::query(), $showId)
            ->select('retention_bucket', DB::raw('COUNT(*) as listens'))
            ->whereNotNull('retention_bucket')
            ->groupBy('retention_bucket')
            ->orderByRaw("FIELD(retention_bucket, '0-25', '25-50', '50-75', '75-100', '100+')")
            ->get()
            ->map(fn ($row) => [
                'bucket' => $row->retention_bucket,
                'listens' => (int) $row->listens,
            ])
            ->all();
    }

    private static function uniqueListeners(?int $showId = null): int
    {
        $userCount = self::scopeListensToShow(PodcastEpisodeListen::whereNotNull('user_id'), $showId)
            ->distinct('user_id')->count('user_id');
        $anonymousCount = self::scopeListensToShow(PodcastEpisodeListen::whereNull('user_id')->whereNotNull('session_hash'), $showId)
            ->distinct('session_hash')->count('session_hash');

        return $userCount + $anonymousCount;
    }

    private static function completionRate(?int $showId = null): int
    {
        $total = self::scopeListensToShow(PodcastEpisodeListen::query(), $showId)->count();
        if ($total === 0) {
            return 0;
        }

        $completed = self::scopeListensToShow(PodcastEpisodeListen::where('completed', true), $showId)->count();
        return (int) round(($completed / $total) * 100);
    }

    private static function rssReadyShowCount(): int
    {
        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_RSS_FEED)) {
            return 0;
        }

        return PodcastShow::query()
            ->published()
            ->where('visibility', 'public')
            ->with(['episodes' => fn ($query) => $query
                ->published()
                ->whereIn('visibility', ['inherit', 'public'])])
            ->get()
            ->filter(fn (PodcastShow $show): bool => $show->episodes->contains(
                fn (PodcastEpisode $episode): bool => self::isMediaReadyForDistribution($episode)
            ))
            ->count();
    }

    /**
     * Creator-facing analytics for one show — reuses the same aggregates as
     * the admin dashboard, scoped to the show. All queries remain tenant
     * scoped via HasTenantScope.
     *
     * @return array{days:int,totals:array,listens_over_time:array,top_episodes:array,retention:array,client_breakdown:array}
     */
    public static function showStats(PodcastShow $show, int $days = 30): array
    {
        $days = max(1, min(365, $days));
        $showId = (int) $show->id;

        $listensOverTime = self::scopeListensToShow(PodcastEpisodeListen::query(), $showId)
            ->where('created_at', '>=', now()->subDays($days - 1)->startOfDay())
            ->selectRaw('DATE(created_at) as listen_date, COUNT(*) as listens')
            ->groupBy('listen_date')
            ->orderBy('listen_date')
            ->get()
            ->map(fn ($row) => [
                'date' => (string) $row->listen_date,
                'listens' => (int) $row->listens,
            ])
            ->all();

        return [
            'days' => $days,
            'totals' => [
                'listens' => self::scopeListensToShow(PodcastEpisodeListen::query(), $showId)->count(),
                'completed_listens' => self::scopeListensToShow(PodcastEpisodeListen::where('completed', true), $showId)->count(),
                'completion_rate' => self::completionRate($showId),
                'unique_listeners' => self::uniqueListeners($showId),
                'subscribers' => (int) $show->subscriber_count,
                'episodes' => (int) $show->episode_count,
            ],
            'listens_over_time' => $listensOverTime,
            'top_episodes' => self::topEpisodes($showId),
            'retention' => self::retentionBreakdown($showId),
            'client_breakdown' => self::clientBreakdown($showId),
        ];
    }

    /** @return array<int,string> MIME types accepted for hosted podcast audio uploads. */
    public static function allowedAudioMimes(): array
    {
        return array_keys(self::ALLOWED_AUDIO_TYPES);
    }

    public static function buildRss(PodcastShow $show): string
    {
        $episodes = PodcastEpisode::where('show_id', $show->id)
            ->published()
            ->distributionReady()
            ->whereIn('visibility', ['inherit', 'public'])
            ->with('chapters')
            ->orderByDesc('published_at')
            ->limit(300)
            ->get();

        $channelLink = self::frontendUrl('/podcasts/' . $show->slug);
        $rss = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">',
            '<channel>',
            '<title>' . self::xml($show->title) . '</title>',
            '<link>' . self::xml($channelLink) . '</link>',
            '<description>' . self::xml((string) ($show->description ?: $show->summary ?: $show->title)) . '</description>',
            '<language>' . self::xml((string) $show->language) . '</language>',
            '<itunes:author>' . self::xml(self::showAuthor()) . '</itunes:author>',
            '<itunes:explicit>' . ($show->explicit ? 'true' : 'false') . '</itunes:explicit>',
        ];

        if ($show->category) {
            $rss[] = '<itunes:category text="' . self::xml((string) $show->category) . '" />';
        }
        if ($show->copyright) {
            $rss[] = '<copyright>' . self::xml((string) $show->copyright) . '</copyright>';
        }
        if (self::isHttpUrl((string) $show->funding_url)) {
            $rss[] = '<podcast:funding url="' . self::xml((string) $show->funding_url) . '">' . self::xml((string) __('api_controllers_2.podcasts.support_show')) . '</podcast:funding>';
        }

        $artworkUrl = UrlHelper::absolute($show->artwork_url);
        if (self::isHttpUrl((string) $artworkUrl)) {
            $rss[] = '<itunes:image href="' . self::xml((string) $artworkUrl) . '" />';
        }

        $skipped = 0;
        foreach ($episodes as $episode) {
            if (!self::isMediaReadyForDistribution($episode)) {
                $skipped++;
                continue;
            }
            $audioUrl = $episode->audio_storage_path
                ? self::episodeAudioUrl($episode, false)
                : (string) $episode->audio_url;
            if (!self::isPodcastMediaUrl($audioUrl)) {
                $skipped++;
                continue;
            }
            $episodeLink = self::frontendUrl('/podcasts/' . $show->slug . '/' . $episode->slug);
            $rss[] = '<item>';
            $rss[] = '<title>' . self::xml($episode->title) . '</title>';
            $rss[] = '<link>' . self::xml($episodeLink) . '</link>';
            $rss[] = '<guid isPermaLink="false">' . self::xml("podcast-{$show->id}-episode-{$episode->id}") . '</guid>';
            $rss[] = '<description>' . self::xml((string) ($episode->description ?: $episode->summary ?: $episode->title)) . '</description>';
            if ($episode->published_at) {
                $rss[] = '<pubDate>' . $episode->published_at->toRfc2822String() . '</pubDate>';
            }
            $enclosureAttrs = [
                'url="' . self::xml($audioUrl) . '"',
                'type="' . self::xml((string) ($episode->audio_mime ?: 'audio/mpeg')) . '"',
            ];
            $enclosureAttrs[] = 'length="' . (int) ($episode->audio_bytes ?? 0) . '"';
            $rss[] = '<enclosure ' . implode(' ', $enclosureAttrs) . ' />';
            if ($episode->duration_seconds) {
                $rss[] = '<itunes:duration>' . gmdate('H:i:s', (int) $episode->duration_seconds) . '</itunes:duration>';
            }
            $rss[] = '<itunes:episodeType>' . self::xml((string) $episode->episode_type) . '</itunes:episodeType>';
            if ($episode->season_number) {
                $rss[] = '<itunes:season>' . (int) $episode->season_number . '</itunes:season>';
            }
            if ($episode->episode_number) {
                $rss[] = '<itunes:episode>' . (int) $episode->episode_number . '</itunes:episode>';
            }
            if ($episode->transcript && PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_TRANSCRIPTS)) {
                $rss[] = '<podcast:transcript url="' . self::xml(self::transcriptUrl($episode)) . '" type="text/plain" language="' . self::xml((string) ($episode->transcript_language ?: $show->language ?: 'en')) . '" />';
            }
            if ($episode->chapters->isNotEmpty() && PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_CHAPTERS)) {
                $rss[] = '<podcast:chapters url="' . self::xml(self::chaptersUrl($episode)) . '" type="application/json+chapters" />';
            }
            $rss[] = '<itunes:explicit>' . ($episode->explicit ? 'true' : 'false') . '</itunes:explicit>';
            $rss[] = '</item>';
        }

        if ($skipped > 0) {
            // Feeds must stay valid, so unresolvable episodes are omitted —
            // but never silently: validateFeed() surfaces the same count.
            Log::info('Podcast RSS build skipped episodes without a valid audio URL', [
                'show_id' => (int) $show->id,
                'skipped' => $skipped,
            ]);
        }

        $rss[] = '</channel>';
        $rss[] = '</rss>';

        return implode("\n", $rss);
    }

    public static function transcriptUrl(PodcastEpisode $episode): string
    {
        return self::apiUrl('/api/v2/podcasts/transcripts/' . (int) $episode->tenant_id . '/' . $episode->id . '.txt');
    }

    public static function chaptersUrl(PodcastEpisode $episode): string
    {
        return self::apiUrl('/api/v2/podcasts/chapters/' . (int) $episode->tenant_id . '/' . $episode->id . '.json');
    }

    public static function findPublicShowForTenant(int $tenantId, string $slug): ?PodcastShow
    {
        if (!TenantContext::setById($tenantId)) {
            return null;
        }

        return self::findShowBySlug($slug);
    }

    public static function findPublicEpisodeForTenant(int $tenantId, int $episodeId): ?PodcastEpisode
    {
        if (!TenantContext::setById($tenantId)) {
            return null;
        }

        $episode = PodcastEpisode::with(['show', 'chapters'])
            ->published()
            ->distributionReady()
            ->find($episodeId);

        if (!$episode
            || !$episode->show
            || !self::canViewEpisode($episode, $episode->show, null, false)
            || !self::isMediaReadyForDistribution($episode)) {
            return null;
        }

        return $episode;
    }

    public static function canViewShow(PodcastShow $show, ?int $userId, bool $isAdmin): bool
    {
        if ($isAdmin || ((int) $show->owner_user_id === (int) $userId && $userId !== null)) {
            return true;
        }

        if ($show->status !== 'published' || $show->moderation_status !== 'approved') {
            return false;
        }

        return match ($show->visibility) {
            'public' => true,
            'members' => $userId !== null,
            default => false,
        };
    }

    public static function canViewEpisode(PodcastEpisode $episode, PodcastShow $show, ?int $userId, bool $isAdmin): bool
    {
        if ($isAdmin || ((int) $episode->author_user_id === (int) $userId && $userId !== null)) {
            return true;
        }

        if (!self::canViewShow($show, $userId, $isAdmin)) {
            return false;
        }

        if (!self::isMediaReadyForDistribution($episode)) {
            return false;
        }

        if ($episode->status !== 'published' || $episode->moderation_status !== 'approved') {
            return false;
        }

        // Embargo: a future-scheduled episode stays hidden from direct URL / listen /
        // audio access until its scheduled time arrives, matching scopePublished()
        // which already hides it from listings and RSS. Admins/authors bypassed above.
        if ($episode->scheduled_for && $episode->scheduled_for->isFuture()) {
            return false;
        }

        $visibility = $episode->visibility === 'inherit' ? $show->visibility : $episode->visibility;

        return match ($visibility) {
            'public' => true,
            'members' => $userId !== null,
            default => false,
        };
    }

    private static function visibleEpisodeQuery($query, PodcastShow $show, ?int $userId, bool $isAdmin)
    {
        if ($isAdmin || ($userId !== null && (int) $show->owner_user_id === (int) $userId)) {
            return $query;
        }

        $query->published()->distributionReady();

        if ($userId !== null) {
            return $query->whereIn('visibility', ['inherit', 'public', 'members']);
        }

        if ($show->visibility === 'public') {
            return $query->whereIn('visibility', ['inherit', 'public']);
        }

        return $query->where('visibility', 'public');
    }

    public static function prepareEpisodeForResponse(PodcastEpisode $episode, ?int $userId, bool $isAdmin): void
    {
        self::applyConfigVisibilityToEpisode($episode);

        if (!$episode->audio_storage_path) {
            return;
        }

        // Failed, infected, unscanned, or still-processing hosted media keeps
        // its non-servable sentinel URL. Do not mint even a signed capability
        // for bytes the media endpoint must reject.
        if (!self::isMediaReadyForDistribution($episode)) {
            // Older cloud rows may have persisted a direct CDN URL before the
            // fail-closed proxy contract was introduced. Normalize it on every
            // response so pending/rejected bytes cannot bypass the media gate.
            $episode->audio_url = self::hostedAudioProxyUrl($episode);
            return;
        }

        $show = $episode->show ?: PodcastShow::find($episode->show_id);
        $publiclyDistributable = $show
            && self::canViewEpisode($episode, $show, null, false)
            && self::isMediaReadyForDistribution($episode);
        $episode->audio_url = $publiclyDistributable
            ? self::episodeAudioUrl($episode, false)
            : self::episodeAudioUrl($episode, true);
    }

    /**
     * Attach the viewer's reaction state + total reaction count to an episode
     * so the client can render the correct toggle state on first paint instead
     * of always showing the un-reacted label.
     */
    public static function decorateEpisodeForViewer(PodcastEpisode $episode, ?int $userId): void
    {
        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_EPISODE_REACTIONS)) {
            $episode->reaction_count = 0;
            $episode->viewer_has_reacted = false;
            return;
        }

        $episode->reaction_count = (int) PodcastEpisodeReaction::where('episode_id', $episode->id)->count();
        $episode->viewer_has_reacted = $userId !== null
            && PodcastEpisodeReaction::where('episode_id', $episode->id)
                ->where('user_id', $userId)
                ->exists();
    }

    private static function syncChapters(PodcastEpisode $episode, mixed $chapters): void
    {
        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_CHAPTERS)) {
            return;
        }

        if (!is_array($chapters)) {
            return;
        }

        if (count($chapters) > self::MAX_CHAPTERS) {
            throw new \InvalidArgumentException('Too many podcast chapters');
        }

        // Normalize first (drop empty titles, clamp negatives, strip unsafe
        // URLs), then order by start time so players always get a coherent,
        // monotonically-sorted chapter list regardless of payload order.
        $normalized = [];
        foreach ($chapters as $chapter) {
            if (!is_array($chapter) || trim((string) ($chapter['title'] ?? '')) === '') {
                continue;
            }
            $normalized[] = [
                'title' => self::nullableText($chapter['title'], 200),
                'starts_at_seconds' => max(0, (int) ($chapter['starts_at_seconds'] ?? 0)),
                'url' => self::safePublicUrl($chapter['url'] ?? null),
            ];
        }
        usort($normalized, static fn (array $a, array $b): int => $a['starts_at_seconds'] <=> $b['starts_at_seconds']);

        PodcastEpisodeChapter::where('episode_id', $episode->id)->delete();

        foreach ($normalized as $position => $chapter) {
            PodcastEpisodeChapter::create([
                'episode_id' => $episode->id,
                'title' => $chapter['title'],
                'starts_at_seconds' => $chapter['starts_at_seconds'],
                'url' => $chapter['url'],
                'position' => $position,
            ]);
        }
    }

    private static function validateChapterPayload(mixed $chapters): void
    {
        if (is_array($chapters) && count($chapters) > self::MAX_CHAPTERS) {
            throw new \InvalidArgumentException('Too many podcast chapters');
        }
    }

    private static function refreshEpisodeCount(PodcastShow $show): void
    {
        $show->episode_count = PodcastEpisode::where('show_id', $show->id)->published()->count();
        $show->save();
    }

    private static function refreshSubscriberCount(PodcastShow $show): void
    {
        $show->subscriber_count = DB::table('podcast_show_subscriptions')
            ->where('tenant_id', TenantContext::getId())
            ->where('show_id', $show->id)
            ->count();
        $show->save();
    }

    private static function findRecentListen(PodcastEpisode $episode, ?int $userId, ?string $sessionHash, ?string $userAgentHash, ?string $ipHash): ?PodcastEpisodeListen
    {
        $query = PodcastEpisodeListen::where('episode_id', $episode->id)
            ->where('created_at', '>=', now()->subHours(self::LISTEN_DEDUPE_WINDOW_HOURS));

        if ($userId !== null) {
            return (clone $query)
                ->where('user_id', $userId)
                ->whereNull('session_hash')
                ->first();
        }

        if ($sessionHash !== null) {
            return (clone $query)->where('session_hash', $sessionHash)->first();
        }

        if ($userAgentHash !== null && $ipHash !== null) {
            return (clone $query)
                ->where('user_agent_hash', $userAgentHash)
                ->where('ip_hash', $ipHash)
                ->whereNull('session_hash')
                ->first();
        }

        return null;
    }

    private static function notifySubscribersOfEpisode(PodcastEpisode $episode): void
    {
        $show = $episode->show ?: PodcastShow::find($episode->show_id);
        if (!$show) {
            return;
        }

        $subscriberIds = DB::table('podcast_show_subscriptions')
            ->where('tenant_id', TenantContext::getId())
            ->where('show_id', $show->id)
            ->where('notify_new_episodes', true)
            ->where('user_id', '<>', (int) $episode->author_user_id)
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        if ($subscriberIds === []) {
            return;
        }

        $users = User::query()
            ->whereIn('id', $subscriberIds)
            ->select('id', 'preferred_language')
            ->get();
        $link = '/podcasts/' . $show->slug . '/' . $episode->slug;

        foreach ($users as $user) {
            LocaleContext::withLocale($user, function () use ($user, $show, $episode, $link): void {
                $exists = DB::table('notifications')
                    ->where('tenant_id', TenantContext::getId())
                    ->where('user_id', (int) $user->id)
                    ->where('type', 'podcast_episode')
                    ->where('link', $link)
                    ->exists();
                if ($exists) {
                    return;
                }

                Notification::createNotification(
                    (int) $user->id,
                    __('svc_notifications.podcast.new_episode', [
                        'show' => $show->title,
                        'title' => $episode->title,
                    ]),
                    $link,
                    'podcast_episode',
                    false,
                    TenantContext::getId()
                );
            });
        }
    }

    private static function moderationEnabled(): bool
    {
        return (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_MODERATION_ENABLED);
    }

    private static function moderationActionToStatus(string $action): string
    {
        return match ($action) {
            'approve' => 'approved',
            'reject' => 'rejected',
            'flag' => 'flagged',
            default => throw new \InvalidArgumentException('Invalid moderation action'),
        };
    }

    private static function normalizeVisibility(string $visibility): string
    {
        // Callers only reach here with members/private when the client sent
        // that value explicitly (absent keys default to 'public'/'inherit'),
        // so rejecting is safe — previously the value was silently downgraded,
        // which surprised creators expecting a restricted show.
        if (in_array($visibility, ['members', 'private'], true) && !PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_PRIVATE_SHOWS)) {
            throw new \InvalidArgumentException('Private podcast shows are disabled for this community');
        }

        return in_array($visibility, ['public', 'members', 'private'], true) ? $visibility : 'public';
    }

    private static function normalizeEpisodeVisibility(string $visibility): string
    {
        if (in_array($visibility, ['members', 'private'], true) && !PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_PRIVATE_SHOWS)) {
            throw new \InvalidArgumentException('Private podcast shows are disabled for this community');
        }

        return in_array($visibility, ['inherit', 'public', 'members', 'private'], true) ? $visibility : 'inherit';
    }

    private static function normalizeEpisodeType(string $type): string
    {
        return in_array($type, ['full', 'trailer', 'bonus'], true) ? $type : 'full';
    }

    private static function mediaStorageDisk(): string
    {
        $driver = (string) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_MEDIA_STORAGE_DRIVER);
        if ($driver !== 'cloud') {
            return 'local';
        }

        return (string) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK, 's3') ?: 's3';
    }

    private static function cloudMediaUrl(string $path): string
    {
        $base = trim((string) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_CLOUD_CDN_BASE_URL, ''));
        if (self::isHttpUrl($base)) {
            return rtrim($base, '/') . '/' . ltrim($path, '/');
        }

        return Storage::disk((string) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK, 's3'))->url($path);
    }

    /**
     * Copy one episode's hosted audio object to another disk and repoint the
     * row at it, verifying the copy byte-for-byte before the row changes.
     * Idempotent: episodes already on the target disk are filtered out by the
     * caller's query and skipped here, so an interrupted
     * `podcasts:migrate-media` run is resumed by simply re-running it.
     *
     * Must run inside the episode's tenant context — regenerating audio_url
     * reads tenant-scoped podcast configuration (CDN base URL, cloud disk).
     * The media proxy serves whichever disk the row names, so there is no
     * window where the episode 404s during migration.
     */
    public static function migrateEpisodeMedia(PodcastEpisode $episode, string $targetDisk, bool $deleteSource = false): string
    {
        $path = (string) $episode->audio_storage_path;
        $sourceDisk = (string) ($episode->audio_storage_disk ?: 'local');

        if ($path === '') {
            return 'skipped_external_audio';
        }
        if ($sourceDisk === $targetDisk) {
            return 'skipped_already_on_target';
        }

        $source = Storage::disk($sourceDisk);
        if (!$source->exists($path)) {
            return 'skipped_missing_source';
        }

        $target = Storage::disk($targetDisk);
        $readStream = $source->readStream($path);
        if (!is_resource($readStream)) {
            return 'failed_source_unreadable';
        }

        try {
            $written = $target->put($path, $readStream);
        } finally {
            if (is_resource($readStream)) {
                fclose($readStream);
            }
        }
        if (!$written) {
            return 'failed_write';
        }

        $sourceHash = self::hashDiskObject($source, $path);
        $targetHash = self::hashDiskObject($target, $path);
        if ($sourceHash === null || $targetHash === null || !hash_equals($sourceHash, $targetHash)) {
            try {
                $target->delete($path);
            } catch (\Throwable) {
                // Leave the bad copy for manual inspection if delete fails.
            }

            return 'failed_checksum';
        }

        $episode->audio_storage_disk = $targetDisk;
        // Persist the neutral proxy URL; ready public response/RSS projection
        // selects the CDN dynamically for the new disk.
        $episode->audio_url = self::hostedAudioProxyUrl($episode);
        $episode->save();

        if ($deleteSource) {
            try {
                $source->delete($path);
            } catch (\Throwable $e) {
                Log::warning('Podcast media migration could not delete source object', [
                    'episode_id' => (int) $episode->id,
                    'disk' => $sourceDisk,
                    'path' => $path,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return 'migrated';
    }

    private static function hashDiskObject(\Illuminate\Contracts\Filesystem\Filesystem $disk, string $path): ?string
    {
        $stream = $disk->readStream($path);
        if (!is_resource($stream)) {
            return null;
        }

        try {
            $context = hash_init('sha256');
            while (!feof($stream)) {
                $chunk = fread($stream, 1024 * 1024);
                if ($chunk === false) {
                    return null;
                }
                hash_update($context, $chunk);
            }

            return hash_final($context);
        } finally {
            fclose($stream);
        }
    }

    /**
     * Verify a filesystem disk end-to-end before podcast media is switched
     * onto it: configuration, driver availability, then a write/read/delete
     * round-trip with a throwaway probe object. Returns a structured report
     * and never throws — a broken disk must produce a diagnosis, not a 500.
     */
    public static function verifyMediaDisk(string $disk): array
    {
        $result = [
            'ok' => false,
            'disk' => $disk,
            'driver' => null,
            'checks' => [
                'configured' => false,
                'driver_installed' => false,
                'write' => false,
                'read' => false,
                'delete' => false,
            ],
            'error' => null,
        ];

        $config = config("filesystems.disks.{$disk}");
        if (!is_array($config)) {
            $result['error'] = 'disk_not_configured';

            return $result;
        }
        $result['checks']['configured'] = true;
        $result['driver'] = (string) ($config['driver'] ?? '');

        if ($result['driver'] === 's3' && !class_exists(\League\Flysystem\AwsS3V3\AwsS3V3Adapter::class)) {
            $result['error'] = 'driver_not_installed';

            return $result;
        }
        $result['checks']['driver_installed'] = true;

        $probePath = sprintf('podcasts/.doctor/probe_%s.txt', bin2hex(random_bytes(8)));
        $payload = 'nexus-podcast-storage-probe ' . now()->toIso8601String();

        try {
            $storage = Storage::disk($disk);

            if (!$storage->put($probePath, $payload)) {
                $result['error'] = 'write_failed';

                return $result;
            }
            $result['checks']['write'] = true;

            if ($storage->get($probePath) !== $payload) {
                $result['error'] = 'read_mismatch';

                return $result;
            }
            $result['checks']['read'] = true;

            $storage->delete($probePath);
            $result['checks']['delete'] = true;
            $result['ok'] = true;
        } catch (\Throwable $e) {
            $result['error'] = $e->getMessage();
            try {
                Storage::disk($disk)->delete($probePath);
            } catch (\Throwable) {
                // Probe cleanup is best-effort on an already-failing disk.
            }
        }

        return $result;
    }

    private static function clientFamily(?string $userAgent): ?string
    {
        if (!$userAgent) {
            return null;
        }

        $ua = strtolower($userAgent);
        return match (true) {
            str_contains($ua, 'applecoremedia'), str_contains($ua, 'podcasts') => 'apple',
            str_contains($ua, 'spotify') => 'spotify',
            str_contains($ua, 'overcast') => 'overcast',
            str_contains($ua, 'pocket casts') => 'pocket_casts',
            str_contains($ua, 'mozilla'), str_contains($ua, 'chrome'), str_contains($ua, 'safari') => 'browser',
            default => 'other',
        };
    }

    private static function retentionBucket(PodcastEpisode $episode, int $listenedSeconds): string
    {
        $duration = max(0, (int) ($episode->duration_seconds ?? 0));
        if ($duration <= 0) {
            return '0-25';
        }

        $percent = ($listenedSeconds / $duration) * 100;
        return match (true) {
            $percent < 25 => '0-25',
            $percent < 50 => '25-50',
            $percent < 75 => '50-75',
            $percent <= 100 => '75-100',
            default => '100+',
        };
    }

    private static function uniqueShowSlug(string $base): string
    {
        return self::uniqueSlug($base, fn (string $candidate): bool => PodcastShow::where('slug', $candidate)->exists(), 'podcast');
    }

    private static function uniqueEpisodeSlug(int $showId, string $base): string
    {
        return self::uniqueSlug($base, fn (string $candidate): bool => PodcastEpisode::where('show_id', $showId)->where('slug', $candidate)->exists(), 'episode');
    }

    private static function uniqueSlug(string $base, callable $exists, string $fallback): string
    {
        $slug = Str::slug($base) ?: $fallback;
        $candidate = $slug;
        $i = 2;

        while ($exists($candidate)) {
            $candidate = $slug . '-' . $i;
            $i++;
        }

        return $candidate;
    }

    private static function nullableText(mixed $value, ?int $limit = null): ?string
    {
        if ($value === null) {
            return null;
        }

        $text = trim((string) $value);
        if ($text === '') {
            return null;
        }

        return $limit ? mb_substr($text, 0, $limit) : $text;
    }

    private static function requiredText(mixed $value, int $limit, string $message): string
    {
        $text = self::nullableText($value, $limit);
        if ($text === null) {
            throw new \InvalidArgumentException($message);
        }

        return $text;
    }

    private static function normalizeReaction(string $reaction): string
    {
        $normalized = preg_replace('/[^a-z0-9_-]/i', '', $reaction) ?: '';
        $normalized = mb_substr($normalized, 0, self::REACTION_MAX_LENGTH);

        return $normalized !== '' ? $normalized : 'like';
    }

    private static function applyConfigVisibilityToEpisode(PodcastEpisode $episode): void
    {
        $transcriptsEnabled = (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_TRANSCRIPTS);
        $chaptersEnabled = (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_CHAPTERS);
        // These model accessors are appended only to response instances, so a
        // later save() can never treat them as database columns.
        $episode->append([
            'transcripts_enabled',
            'chapters_enabled',
            'reactions_enabled',
            'hosted_audio',
        ]);

        if (!$transcriptsEnabled) {
            $episode->transcript = null;
            $episode->transcript_language = null;
        }

        if (!$chaptersEnabled) {
            $episode->setRelation('chapters', collect());
        }
    }

    private static function nullableUrl(mixed $value): ?string
    {
        $url = self::nullableText($value, 1000);
        if ($url === null) {
            return null;
        }

        return self::isHttpUrl($url) ? $url : null;
    }

    private static function nullableArtworkPath(mixed $value): ?string
    {
        $path = self::nullableText($value, 1000);
        if ($path === null) {
            return null;
        }

        $safePath = self::safePodcastArtworkPath($path);
        if ($safePath !== null) {
            return $safePath;
        }

        throw new \InvalidArgumentException('External podcast artwork is not allowed');
    }

    /**
     * Return only an image path created in the current tenant's podcast upload
     * namespace. This is also used by model accessors to fail closed for legacy
     * rows containing external trackers, another tenant's upload, or traversal.
     */
    public static function safePodcastArtworkPath(mixed $value): ?string
    {
        $path = is_string($value) ? trim($value) : '';
        $tenant = TenantContext::currentId() !== null ? TenantContext::get() : null;
        if ($path === '' || !is_array($tenant)) {
            return null;
        }

        $slug = (string) ($tenant['slug'] ?? 'default');
        if ((int) ($tenant['id'] ?? 0) === 1 && $slug === '') {
            $slug = 'master';
        }
        if ($slug === '' || preg_match('/\A[A-Za-z0-9][A-Za-z0-9_-]*\z/', $slug) !== 1) {
            return null;
        }

        $prefix = '/uploads/tenants/' . $slug . '/podcasts/';
        if (!str_starts_with($path, $prefix)
            || str_contains($path, '\\')
            || str_contains($path, '%')
            || str_contains($path, '..')
            || str_contains($path, '?')
            || str_contains($path, '#')) {
            return null;
        }

        $filename = substr($path, strlen($prefix));
        return preg_match('/\A[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|gif|webp)\z/i', $filename) === 1
            ? $path
            : null;
    }

    public static function safePublicUrl(mixed $value): ?string
    {
        return self::nullableUrl($value);
    }

    private static function nullableEmail(mixed $value): ?string
    {
        $email = self::nullableText($value, 320);
        if ($email === null) {
            return null;
        }

        return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
    }

    private static function showAuthor(): string
    {
        // Public RSS is an identity-free tenant publication. Creator names and
        // contact emails remain available only in the authenticated studio.
        return TenantContext::getName('Project NEXUS');
    }

    private static function requiredUrl(mixed $value): string
    {
        $url = self::nullableText($value, 1000);
        if ($url === null || !self::isPodcastMediaUrl($url)) {
            throw new \InvalidArgumentException('Invalid podcast media URL');
        }

        return $url;
    }

    private static function isHttpUrl(string $value): bool
    {
        $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));
        return in_array($scheme, ['http', 'https'], true) && filter_var($value, FILTER_VALIDATE_URL) !== false;
    }

    private static function isPodcastMediaUrl(string $value): bool
    {
        if (filter_var($value, FILTER_VALIDATE_URL) === false) {
            return false;
        }

        $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));
        if ($scheme === 'https') {
            return true;
        }

        $host = strtolower((string) parse_url($value, PHP_URL_HOST));
        return $scheme === 'http'
            && app()->environment(['local', 'development', 'testing'])
            && in_array($host, ['localhost', '127.0.0.1', '::1'], true);
    }

    private static function normalizeAudioBytes(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        $bytes = max(0, (int) $value);
        $maxMb = (int) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_MAX_AUDIO_SIZE_MB);
        if ($maxMb > 0 && $bytes > ($maxMb * 1024 * 1024)) {
            throw new \InvalidArgumentException('Podcast audio file is too large');
        }

        return $bytes;
    }

    private static function replaceHostedAudio(PodcastEpisode $episode, UploadedFile $file): void
    {
        // Defer the processing job until the update transaction commits and the
        // previous object has been retired. Otherwise a fast worker can process
        // media that the replacement compensation subsequently removes.
        self::storeHostedAudio($episode, $file, false);
    }

    private static function clearHostedAudio(PodcastEpisode $episode): void
    {
        $episode->audio_storage_path = null;
        $episode->audio_storage_disk = null;
    }

    /** @return array<string, mixed> */
    private static function episodeMediaAttributes(PodcastEpisode $episode): array
    {
        $attributes = [];
        foreach ([
            'audio_url',
            'audio_storage_disk',
            'audio_storage_path',
            'audio_mime',
            'audio_bytes',
            'duration_seconds',
            'media_processing_status',
            'media_scan_status',
            'media_failure_reason',
            'media_duration_source',
            'media_waveform_json',
        ] as $field) {
            $attributes[$field] = $episode->getRawOriginal($field);
        }

        return $attributes;
    }

    private static function queueMediaProcessing(PodcastEpisode $episode): void
    {
        if ($episode->media_processing_status === 'pending' || $episode->media_scan_status === 'pending') {
            ProcessPodcastEpisodeMedia::dispatch(TenantContext::getId(), (int) $episode->id)->afterCommit();
        }
    }

    private static function deleteEpisodeRecords(PodcastEpisode $episode): void
    {
        PodcastEpisodeChapter::where('episode_id', $episode->id)->delete();
        PodcastEpisodeListen::where('episode_id', $episode->id)->delete();
        PodcastEpisodeReaction::where('episode_id', $episode->id)->delete();
        DB::table('podcast_episode_reports')
            ->where('tenant_id', TenantContext::getId())
            ->where('episode_id', $episode->id)
            ->delete();
        app(FeedActivityService::class)->removeActivity('podcast_episode', (int) $episode->id);
        $episode->delete();
    }

    private static function deleteStorageObject(string $disk, string $path, bool $required): bool
    {
        try {
            $storage = Storage::disk($disk);
            if (!$storage->exists($path)) {
                return true;
            }
            if ($storage->delete($path)) {
                return true;
            }
        } catch (\Throwable $e) {
            if ($required) {
                throw new \RuntimeException('Podcast media storage deletion failed', 0, $e);
            }
            Log::warning('Podcast media cleanup failed', [
                'disk' => $disk,
                'path' => $path,
                'error' => $e->getMessage(),
            ]);
            return false;
        }

        if ($required) {
            throw new \RuntimeException('Podcast media storage deletion failed');
        }

        Log::warning('Podcast media cleanup returned false', ['disk' => $disk, 'path' => $path]);
        return false;
    }

    private static function deletePodcastImage(?string $url, bool $required): bool
    {
        $safeUrl = self::safePodcastArtworkPath($url);
        if ($safeUrl === null) {
            return true;
        }

        $physicalPath = base_path('httpdocs' . $safeUrl);
        if (!is_file($physicalPath)) {
            return true;
        }

        if (ImageUploader::deleteTenantUpload($safeUrl, 'podcasts')) {
            return true;
        }

        if ($required) {
            throw new \RuntimeException('Podcast image storage deletion failed');
        }

        Log::warning('Podcast image cleanup returned false', ['path' => $safeUrl]);
        return false;
    }

    private static function privateHash(string $value): string
    {
        return hash_hmac('sha256', $value, (string) config('app.key'));
    }

    private static function mediaSignature(int $tenantId, int $episodeId, int $expires): string
    {
        return hash_hmac('sha256', $tenantId . '|' . $episodeId . '|' . $expires, (string) config('app.key'));
    }

    private static function syncShowFeedActivity(PodcastShow $show): void
    {
        $feed = app(FeedActivityService::class);
        $eligible = $show->status === 'published'
            && $show->moderation_status === 'approved'
            && in_array($show->visibility, ['public', 'members'], true);

        if ($eligible) {
            self::recordFeedActivity(
                'podcast_show',
                (int) $show->id,
                (int) $show->owner_user_id,
                (string) $show->title,
                $show->summary,
                $show->artwork_url,
                [
                    'slug' => $show->slug,
                    'detail_path' => '/podcasts/' . $show->slug,
                ]
            );
        } else {
            $feed->hideActivity('podcast_show', (int) $show->id);
        }

        PodcastEpisode::where('show_id', $show->id)
            ->with('show')
            ->get()
            ->each(fn (PodcastEpisode $episode) => self::syncEpisodeFeedActivity($episode));
    }

    private static function syncEpisodeFeedActivity(PodcastEpisode $episode): void
    {
        $show = $episode->show ?: PodcastShow::find($episode->show_id);
        $effectiveVisibility = $show
            ? ($episode->visibility === 'inherit' ? $show->visibility : $episode->visibility)
            : 'private';
        $eligible = $show
            && $show->status === 'published'
            && $show->moderation_status === 'approved'
            && in_array($show->visibility, ['public', 'members'], true)
            && $episode->status === 'published'
            && $episode->moderation_status === 'approved'
            && (!$episode->scheduled_for || $episode->scheduled_for->isPast())
            && in_array($effectiveVisibility, ['public', 'members'], true)
            && self::isMediaReadyForDistribution($episode);

        if (!$eligible) {
            app(FeedActivityService::class)->hideActivity('podcast_episode', (int) $episode->id);
            return;
        }

        self::recordFeedActivity(
            'podcast_episode',
            (int) $episode->id,
            (int) $episode->author_user_id,
            (string) $episode->title,
            $episode->summary,
            $episode->cover_image_url,
            [
                'show_id' => (int) $episode->show_id,
                'show_slug' => $show->slug,
                'slug' => $episode->slug,
                'detail_path' => '/podcasts/' . $show->slug . '/' . $episode->slug,
            ]
        );
    }

    private static function removeShowFeedActivities(PodcastShow $show): void
    {
        $feed = app(FeedActivityService::class);
        PodcastEpisode::where('show_id', $show->id)
            ->pluck('id')
            ->each(fn ($episodeId) => $feed->removeActivity('podcast_episode', (int) $episodeId));
        $feed->removeActivity('podcast_show', (int) $show->id);
    }

    private static function recordFeedActivity(string $type, int $entityId, int $userId, string $title, ?string $summary, ?string $imageUrl, array $metadata): void
    {
        try {
            app(FeedActivityService::class)->recordActivity(
                TenantContext::getId(),
                $userId,
                $type,
                $entityId,
                [
                    'title' => $title,
                    'content' => (string) ($summary ?? ''),
                    'image_url' => $imageUrl,
                    'metadata' => $metadata,
                ]
            );
        } catch (\Throwable $e) {
            Log::warning('[PodcastService] feed post failed', ['error' => $e->getMessage()]);
        }
    }

    private static function frontendUrl(string $path): string
    {
        return rtrim(TenantContext::getFrontendUrl(), '/') . TenantContext::getSlugPrefix() . $path;
    }

    private static function apiUrl(string $path): string
    {
        return rtrim((string) config('app.url'), '/') . $path;
    }

    private static function xml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
