<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Core\ImageUploader;
use App\Exceptions\SafeguardingPolicyException;
use App\Http\Controllers\Api\Concerns\InteractsWithPodcasts;
use App\Models\PodcastEpisode;
use App\Models\PodcastShow;
use App\Services\PodcastConfigurationService;
use App\Services\PodcastCreationReceiptService;
use App\Services\PodcastService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PodcastController extends BaseApiController
{
    use InteractsWithPodcasts;

    private const TITLE_MAX_LENGTH = 200;

    protected bool $isV2Api = true;

    public function index(): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_browse', 60, 60);

        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $result = PodcastService::browse([
            'page' => $this->queryInt('page', 1, 1),
            'per_page' => $this->queryInt('per_page', 12, 1, 50),
            'search' => $this->query('q'),
            'category' => $this->query('category'),
            'sort' => $this->query('sort'),
            'include_member_only' => $userId !== null,
        ]);

        $response = $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page'],
        );
        $payload = $response->getData(true);
        $payload['meta']['categories'] = PodcastService::getDistinctCategories($userId !== null);
        $response->setData($payload);

        return $response;
    }

    public function show(string $showSlug): JsonResponse
    {
        $this->ensurePodcastsFeature();

        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $isAdmin = $this->callerIsAdmin();
        $show = PodcastService::findShowBySlug($showSlug, $userId, $isAdmin);
        if (!$show) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.show_not_found'), null, 404);
        }

        if (!PodcastService::canViewShow($show, $userId, $isAdmin)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.show_not_found'), null, 404);
        }

        $data = $show->toArray();
        $data['episode_count'] = $show->episodes->count();
        $data['rss_enabled'] = $show->visibility === 'public'
            && PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_RSS_FEED);

        return $this->respondWithData($data);
    }

    public function episode(string $showSlug, string $episodeSlug): JsonResponse
    {
        $this->ensurePodcastsFeature();

        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $isAdmin = $this->callerIsAdmin();
        $show = PodcastService::findShowBySlug($showSlug, $userId, $isAdmin);
        if (!$show) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.show_not_found'), null, 404);
        }

        $episode = PodcastService::findEpisodeBySlug($show, $episodeSlug);
        if (!$episode) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        if (!PodcastService::canViewEpisode($episode, $show, $userId, $isAdmin)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        PodcastService::decorateEpisodeForViewer($episode, $userId);

        return $this->respondWithData($episode->toArray());
    }

    public function rss(string $showSlug): Response
    {
        $this->ensurePodcastsFeature();

        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_RSS_FEED)) {
            abort(404);
        }

        $show = PodcastService::findShowBySlug($showSlug);
        if (!$show || !PodcastService::canViewShow($show, null, false) || $show->visibility !== 'public') {
            abort(404);
        }

        return response(PodcastService::buildRss($show), 200)
            ->header('Content-Type', 'application/rss+xml; charset=UTF-8');
    }

    public function rssForTenant(int $tenantId, string $showSlug): Response
    {
        if (!TenantContext::setById($tenantId)) {
            abort(404);
        }
        $this->ensurePodcastsFeature();

        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_RSS_FEED)) {
            abort(404);
        }

        $show = PodcastService::findPublicShowForTenant($tenantId, $showSlug);
        if (!$show || !PodcastService::canViewShow($show, null, false) || $show->visibility !== 'public') {
            abort(404);
        }

        return response(PodcastService::buildRss($show), 200)
            ->header('Content-Type', 'application/rss+xml; charset=UTF-8');
    }

    public function authored(): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $userId = $this->requirePodcastAuthor();
        $allowMemberCreation = (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ALLOW_MEMBER_SHOW_CREATION);
        $currentShowCount = PodcastService::ownedShowCount($userId);
        $isAdmin = $this->callerIsAdmin();
        $maxShowsPerUser = (int) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_MAX_SHOWS_PER_USER);
        $withinShowLimit = $maxShowsPerUser <= 0 || $currentShowCount < $maxShowsPerUser;

        // Upload constraints ride along so the studio can validate files
        // client-side before starting a multi-hundred-MB upload.
        return $this->respondWithData(PodcastService::authoredBy($userId), [
            'max_audio_size_mb' => (int) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_MAX_AUDIO_SIZE_MB),
            'allowed_audio_mimes' => PodcastService::allowedAudioMimes(),
            'allow_member_show_creation' => $allowMemberCreation,
            'can_create_show' => ($allowMemberCreation || $isAdmin) && $withinShowLimit,
            'can_manage_existing_shows' => true,
            'current_show_count' => $currentShowCount,
            'enable_private_shows' => (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_PRIVATE_SHOWS),
            'enable_transcripts' => (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_TRANSCRIPTS),
            'enable_chapters' => (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_CHAPTERS),
            'enable_episode_reactions' => (bool) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_EPISODE_REACTIONS),
            'max_shows_per_user' => $maxShowsPerUser,
        ]);
    }

    /**
     * GET /v2/podcasts/{id}/validate-feed
     *
     * Creator-facing RSS preflight (owner or admin) — the same validation
     * admins run, so creators can fix feed problems before publishing.
     */
    public function validateFeedForOwner(int $id): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $userId = $this->requireAuth();
        $show = $this->findPodcastShowOrFail($id);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);

        return $this->respondWithData(PodcastService::validateFeed($show));
    }

    /**
     * GET /v2/podcasts/{id}/stats?days=30
     *
     * Creator-facing listen analytics for one show (owner or admin).
     */
    public function stats(int $id): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $userId = $this->requireAuth();
        $show = $this->findPodcastShowOrFail($id);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);

        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_LISTEN_ANALYTICS)) {
            return $this->respondWithData(['enabled' => false]);
        }

        $days = $this->queryInt('days', 30, 1, 365) ?? 30;

        return $this->respondWithData(array_merge(['enabled' => true], PodcastService::showStats($show, $days)));
    }

    public function store(): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastShowCreator();
        $input = $this->getAllInput();
        $identity = $this->podcastCreationIdentity($input);
        if ($identity === false) {
            return $this->respondWithError('VALIDATION_FAILED', __('api.invalid_input'), 'idempotency_key', 422);
        }

        $titleError = $this->validatePodcastTitle($input['title'] ?? null, 'api_controllers_2.podcasts.title_required');
        if ($titleError) {
            return $titleError;
        }

        $maxShows = (int) PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_MAX_SHOWS_PER_USER);
        if ($maxShows > 0 && PodcastService::ownedShowCount($userId) >= $maxShows) {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.podcasts.max_shows_reached', ['max' => $maxShows]), null, 422);
        }

        try {
            $result = $identity === null
                ? ['show' => PodcastService::createShow($userId, $input), 'replayed' => false]
                : PodcastCreationReceiptService::createShow($userId, $input, $identity);
            $show = $result['show'];
        } catch (\InvalidArgumentException $e) {
            if (str_contains($e->getMessage(), 'Idempotency key')) {
                return $this->respondWithError('IDEMPOTENCY_CONFLICT', __('api.invalid_input'), 'idempotency_key', 409);
            }
            return $this->podcastValidationError($e);
        } catch (\DomainException) {
            return $this->respondWithError('IDEMPOTENCY_RESULT_GONE', __('api.invalid_input'), 'idempotency_key', 409);
        }

        return $this->respondWithData($show->makeVisible('owner_email'), null, $result['replayed'] ? 200 : 201);
    }

    public function update(int $id): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($id);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);

        $input = $this->getAllInput();
        if (array_key_exists('title', $input)) {
            $titleError = $this->validatePodcastTitle($input['title'], 'api_controllers_2.podcasts.title_required');
            if ($titleError) {
                return $titleError;
            }
        }

        try {
            return $this->respondWithData(PodcastService::updateShow($show, $input)->makeVisible('owner_email'));
        } catch (\InvalidArgumentException $e) {
            return $this->podcastValidationError($e);
        }
    }

    public function publish(int $id): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($id);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);

        return $this->respondWithData(PodcastService::publishShow($show)->makeVisible('owner_email'));
    }

    public function uploadArtwork(int $id): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_image_upload', 10, 60);
        $userId = $this->requirePodcastAuthor();
        $show = $this->findPodcastShowOrFail($id);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);
        $oldUrl = $show->artwork_url;
        $oldModeration = [
            'status' => $show->moderation_status,
            'notes' => $show->moderation_notes,
            'by' => $show->moderated_by,
            'at' => $show->moderated_at,
        ];

        $url = $this->storePodcastImage();
        if ($url instanceof JsonResponse) {
            return $url;
        }

        try {
            PodcastService::updateShow($show, ['artwork_url' => $url]);
        } catch (\Throwable $e) {
            ImageUploader::deleteTenantUpload($url, 'podcasts');
            throw $e;
        }
        $oldPhysicalPath = $oldUrl ? base_path('httpdocs' . $oldUrl) : null;
        if ($oldUrl && $oldUrl !== $url && is_string($oldPhysicalPath) && is_file($oldPhysicalPath)
            && !ImageUploader::deleteTenantUpload($oldUrl, 'podcasts')) {
            ImageUploader::deleteTenantUpload($url, 'podcasts');
            $show->artwork_url = $oldUrl;
            $show->moderation_status = $oldModeration['status'];
            $show->moderation_notes = $oldModeration['notes'];
            $show->moderated_by = $oldModeration['by'];
            $show->moderated_at = $oldModeration['at'];
            $show->save();
            PodcastService::updateShow($show, []);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'image', 500);
        }

        return $this->respondWithData(['url' => $url]);
    }

    public function archive(int $id): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($id);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);

        return $this->respondWithData(PodcastService::archiveShow($show)->makeVisible('owner_email'));
    }

    public function destroy(int $id): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($id);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);
        PodcastService::deleteShow($show);

        return $this->respondWithData(['deleted' => true]);
    }

    public function storeEpisode(int $showId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($showId);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);

        $input = $this->podcastInput();
        $title = trim((string) ($input['title'] ?? ''));
        $audioUrl = trim((string) $this->input('audio_url', ''));
        $audioFile = request()->file('audio');
        $intent = $input;
        unset($intent['idempotency_key'], $intent['audio']);
        if ($audioFile) {
            $realPath = $audioFile->getRealPath();
            if (!is_string($realPath) || $realPath === '' || !is_file($realPath)) {
                return $this->respondWithError('VALIDATION_FAILED', __('api.invalid_input'), 'audio', 422);
            }
            $intent['audio_content_sha256'] = hash_file('sha256', $realPath);
            $intent['audio_bytes'] = $audioFile->getSize();
            $intent['audio_mime'] = $audioFile->getMimeType();
        }
        $identity = $this->podcastCreationIdentity($intent);
        if ($identity === false) {
            return $this->respondWithError('VALIDATION_FAILED', __('api.invalid_input'), 'idempotency_key', 422);
        }
        $titleError = $this->validatePodcastTitle($title, 'api_controllers_2.podcasts.episode_title_required');
        if ($titleError) {
            return $titleError;
        }
        if ($audioUrl === '' && !$audioFile) {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.podcasts.audio_url_required'), 'audio_url', 422);
        }
        $scheduleError = $this->validatePodcastSchedule($input);
        if ($scheduleError) {
            return $scheduleError;
        }

        try {
            $result = $identity === null
                ? ['episode' => PodcastService::createEpisode($show, $userId, $input, $audioFile), 'replayed' => false]
                : PodcastCreationReceiptService::createEpisode($show, $userId, $input, $audioFile, $identity);
            $episode = $result['episode'];
        } catch (\InvalidArgumentException $e) {
            if (str_contains($e->getMessage(), 'Idempotency key')) {
                return $this->respondWithError('IDEMPOTENCY_CONFLICT', __('api.invalid_input'), 'idempotency_key', 409);
            }
            return $this->podcastValidationError($e);
        } catch (\DomainException) {
            return $this->respondWithError('IDEMPOTENCY_RESULT_GONE', __('api.invalid_input'), 'idempotency_key', 409);
        }

        return $this->respondWithData($episode, null, $result['replayed'] ? 200 : 201);
    }

    public function updateEpisode(int $showId, int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($showId);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);
        $episode = $this->findPodcastEpisodeOrFail($episodeId);
        if ((int) $episode->show_id !== $show->id) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        $input = $this->podcastInput();
        if (array_key_exists('title', $input)) {
            $titleError = $this->validatePodcastTitle($input['title'], 'api_controllers_2.podcasts.episode_title_required');
            if ($titleError) {
                return $titleError;
            }
        }
        $scheduleError = $this->validatePodcastSchedule($input);
        if ($scheduleError) {
            return $scheduleError;
        }

        try {
            return $this->respondWithData(PodcastService::updateEpisode($episode, $input, request()->file('audio')));
        } catch (\InvalidArgumentException $e) {
            return $this->podcastValidationError($e);
        }
    }

    public function publishEpisode(int $showId, int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($showId);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);
        $episode = $this->findPodcastEpisodeOrFail($episodeId);
        if ((int) $episode->show_id !== $show->id) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        try {
            return $this->respondWithData(PodcastService::publishEpisode($episode));
        } catch (\InvalidArgumentException $e) {
            return $this->podcastValidationError($e);
        }
    }

    public function uploadEpisodeCover(int $showId, int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_image_upload', 10, 60);
        $userId = $this->requirePodcastAuthor();
        $show = $this->findPodcastShowOrFail($showId);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);
        $episode = $this->findPodcastEpisodeOrFail($episodeId);
        if ((int) $episode->show_id !== $show->id) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }
        $oldUrl = $episode->cover_image_url;
        $oldModeration = [
            'status' => $episode->moderation_status,
            'notes' => $episode->moderation_notes,
            'by' => $episode->moderated_by,
            'at' => $episode->moderated_at,
        ];

        $url = $this->storePodcastImage();
        if ($url instanceof JsonResponse) {
            return $url;
        }

        try {
            PodcastService::updateEpisode($episode, ['cover_image_url' => $url]);
        } catch (\Throwable $e) {
            ImageUploader::deleteTenantUpload($url, 'podcasts');
            throw $e;
        }
        $oldPhysicalPath = $oldUrl ? base_path('httpdocs' . $oldUrl) : null;
        if ($oldUrl && $oldUrl !== $url && is_string($oldPhysicalPath) && is_file($oldPhysicalPath)
            && !ImageUploader::deleteTenantUpload($oldUrl, 'podcasts')) {
            ImageUploader::deleteTenantUpload($url, 'podcasts');
            $episode->cover_image_url = $oldUrl;
            $episode->moderation_status = $oldModeration['status'];
            $episode->moderation_notes = $oldModeration['notes'];
            $episode->moderated_by = $oldModeration['by'];
            $episode->moderated_at = $oldModeration['at'];
            $episode->save();
            PodcastService::updateEpisode($episode, []);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'image', 500);
        }

        return $this->respondWithData(['url' => $url]);
    }

    public function archiveEpisode(int $showId, int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($showId);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);
        $episode = $this->findPodcastEpisodeOrFail($episodeId);
        if ((int) $episode->show_id !== $show->id) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        return $this->respondWithData(PodcastService::archiveEpisode($episode));
    }

    public function destroyEpisode(int $showId, int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_write', 30, 60);
        $userId = $this->requirePodcastAuthor();

        $show = $this->findPodcastShowOrFail($showId);
        $this->ensurePodcastOwnerOrAdmin($show, $userId);
        $episode = $this->findPodcastEpisodeOrFail($episodeId);
        if ((int) $episode->show_id !== $show->id) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }
        PodcastService::deleteEpisode($episode);

        return $this->respondWithData(['deleted' => true]);
    }

    public function listen(int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_listen', 120, 60);
        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $episode = PodcastEpisode::with(['show', 'chapters'])->find($episodeId);

        if (!$episode || !$episode->show || !PodcastService::canViewEpisode($episode, $episode->show, $userId, $this->callerIsAdmin())) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        PodcastService::recordListen($episode, $userId, $this->getAllInput(), request()->userAgent(), request()->ip());

        return $this->respondWithData(['recorded' => true]);
    }

    public function reaction(int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_reaction', 60, 60);
        $userId = $this->requireAuth();
        $episode = $this->findPodcastEpisodeOrFail($episodeId);

        if (!$episode->show || !PodcastService::canViewEpisode($episode, $episode->show, $userId, $this->callerIsAdmin())) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        try {
            $active = PodcastService::toggleReaction(
                $episode,
                $userId,
                (string) $this->input('reaction', 'like'),
                request()->has('active') ? filter_var($this->input('active'), FILTER_VALIDATE_BOOLEAN) : null,
            );
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        return $this->respondWithData(['active' => $active]);
    }

    public function subscribe(int $showId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_subscribe', 30, 60);
        $userId = $this->requireAuth();
        $show = $this->findPodcastShowOrFail($showId);

        if (!PodcastService::canViewShow($show, $userId, $this->callerIsAdmin())) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.show_not_found'), null, 404);
        }

        $subscribed = PodcastService::toggleSubscription(
            $show,
            $userId,
            filter_var($this->input('notify_new_episodes', true), FILTER_VALIDATE_BOOLEAN),
            request()->has('subscribed') ? filter_var($this->input('subscribed'), FILTER_VALIDATE_BOOLEAN) : null,
        );

        return $this->respondWithData(['subscribed' => $subscribed]);
    }

    public function report(int $episodeId): JsonResponse
    {
        $this->ensurePodcastsFeature();
        $this->rateLimit('podcasts_report', 10, 60);
        $userId = $this->requireAuth();
        $episode = $this->findPodcastEpisodeOrFail($episodeId);

        if (!$episode->show || !PodcastService::canViewEpisode($episode, $episode->show, $userId, $this->callerIsAdmin())) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        $reason = trim((string) $this->input('reason', ''));
        if ($reason === '') {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.podcasts.report_reason_required'), 'reason', 422);
        }

        return $this->respondWithData(
            PodcastService::reportEpisode($episode, $userId, $reason, $this->input('details')),
            null,
            201
        );
    }

    public function audio(int $tenantId, int $episodeId): BinaryFileResponse|JsonResponse|RedirectResponse
    {
        if (!TenantContext::setById($tenantId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }
        $this->ensurePodcastsFeature();
        $episode = PodcastEpisode::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->find($episodeId);
        $show = $episode
            ? PodcastShow::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->find($episode->show_id)
            : null;

        if (!$episode || !$show) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }
        $episode->setRelation('show', $show);

        // Quarantined media is never servable — belt-and-braces alongside the
        // object deletion performed by ProcessPodcastEpisodeMedia.
        if (!PodcastService::isMediaReadyForDistribution($episode)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        $canView = PodcastService::canViewEpisode($episode, $show, null, false)
            || PodcastService::hasValidMediaSignature(
                $episode,
                $tenantId,
                request()->query('expires') !== null ? (string) request()->query('expires') : null,
                request()->query('signature') !== null ? (string) request()->query('signature') : null
            );

        if (!$canView) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        if (($episode->audio_storage_disk ?? 'local') !== 'local') {
            $cloudUrl = PodcastService::cloudAccessUrl($episode);
            if ($cloudUrl) {
                return redirect()->away($cloudUrl);
            }

            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        $path = PodcastService::mediaPath($episode);
        if (!$path || !is_file($path)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        // BinaryFileResponse (response()->file) computes Content-Length and handles
        // Range / 206 partial-content itself; setting a manual full-file Content-Length
        // conflicts with range requests, so we let the response manage it.
        return response()->file($path, [
            'Content-Type' => $episode->audio_mime ?: 'audio/mpeg',
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => PodcastService::canViewEpisode($episode, $show, null, false)
                ? 'public, max-age=300'
                : 'private, max-age=300',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function transcript(int $tenantId, int $episodeId): Response|JsonResponse
    {
        if (!TenantContext::setById($tenantId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }
        $this->ensurePodcastsFeature();

        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_TRANSCRIPTS)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        $episode = PodcastService::findPublicEpisodeForTenant($tenantId, $episodeId);
        if (!$episode || !$episode->transcript) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        return response((string) $episode->transcript, 200)
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'public, max-age=300')
            ->header('X-Content-Type-Options', 'nosniff');
    }

    public function chapters(int $tenantId, int $episodeId): JsonResponse
    {
        if (!TenantContext::setById($tenantId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }
        $this->ensurePodcastsFeature();

        if (!PodcastConfigurationService::get(PodcastConfigurationService::CONFIG_ENABLE_CHAPTERS)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        $episode = PodcastService::findPublicEpisodeForTenant($tenantId, $episodeId);
        if (!$episode || $episode->chapters->isEmpty()) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.podcasts.episode_not_found'), null, 404);
        }

        $chapters = $episode->chapters->map(fn ($chapter) => [
            'startTime' => (int) $chapter->starts_at_seconds,
            'title' => (string) $chapter->title,
            'url' => PodcastService::safePublicUrl($chapter->url),
        ])->values()->all();

        return response()->json([
            'version' => '1.2.0',
            'chapters' => $chapters,
        ])->header('Cache-Control', 'public, max-age=300');
    }

    private function podcastValidationError(\InvalidArgumentException $e): JsonResponse
    {
        $message = $e->getMessage();
        [$code, $key, $status] = match (true) {
            str_contains($message, 'too large') => ['VALIDATION_FAILED', 'audio_too_large', 422],
            str_contains($message, 'Unsupported') => ['VALIDATION_FAILED', 'invalid_media_type', 422],
            str_contains($message, 'storage failed') => ['MEDIA_UPLOAD_FAILED', 'media_upload_failed', 500],
            str_contains($message, 'not ready for publishing') => ['MEDIA_NOT_READY', 'media_not_ready', 409],
            str_contains($message, 'External podcast artwork') => ['VALIDATION_FAILED', 'external_artwork_not_allowed', 422],
            str_contains($message, 'Private podcast shows') => ['VALIDATION_FAILED', 'private_shows_disabled', 422],
            str_contains($message, 'Too many podcast chapters') => ['VALIDATION_FAILED', 'too_many_chapters', 422],
            default => ['VALIDATION_FAILED', 'invalid_media_url', 422],
        };

        return $this->respondWithError($code, __("api_controllers_2.podcasts.{$key}"), null, $status);
    }

    private function storePodcastImage(): string|JsonResponse
    {
        $file = request()->file('image');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_FAILED', __('api.no_image_uploaded'), 'image', 422);
        }

        try {
            return (string) ImageUploader::upload([
                'name' => $file->getClientOriginalName(),
                'type' => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error' => UPLOAD_ERR_OK,
                'size' => $file->getSize(),
            ], 'podcasts', [
                'crop' => true,
                'width' => 1400,
                'height' => 1400,
            ]);
        } catch (\Throwable $e) {
            \Log::warning('Podcast image upload failed', [
                'tenant_id' => TenantContext::getId(),
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'image', 422);
        }
    }

    private function podcastInput(): array
    {
        $input = $this->getAllInput();
        if (isset($input['chapters']) && is_string($input['chapters'])) {
            $decoded = json_decode($input['chapters'], true);
            $input['chapters'] = is_array($decoded) ? $decoded : [];
        }

        return $input;
    }

    /** @return array{key_hash:string,request_hash:string}|null|false */
    private function podcastCreationIdentity(array $intent): array|null|false
    {
        $header = request()->header('Idempotency-Key');
        $body = $intent['idempotency_key'] ?? request()->input('idempotency_key');
        if ($header !== null && $body !== null && !hash_equals(trim((string) $header), trim((string) $body))) {
            return false;
        }
        unset($intent['idempotency_key']);
        return PodcastCreationReceiptService::identity((string) ($header ?? $body ?? ''), $intent);
    }

    private function validatePodcastTitle(mixed $value, string $requiredKey): ?JsonResponse
    {
        $title = trim((string) $value);
        if ($title === '') {
            return $this->respondWithError('VALIDATION_FAILED', __($requiredKey), 'title', 422);
        }

        if (mb_strlen($title) > self::TITLE_MAX_LENGTH) {
            return $this->respondWithError(
                'VALIDATION_FAILED',
                __('api_controllers_2.podcasts.title_too_long', ['max' => self::TITLE_MAX_LENGTH]),
                'title',
                422
            );
        }

        return null;
    }

    private function validatePodcastSchedule(array $input): ?JsonResponse
    {
        if (!array_key_exists('scheduled_for', $input) || $input['scheduled_for'] === null || $input['scheduled_for'] === '') {
            return null;
        }

        try {
            Carbon::parse((string) $input['scheduled_for']);
        } catch (\Throwable) {
            return $this->respondWithError(
                'VALIDATION_FAILED',
                __('api_controllers_2.podcasts.invalid_scheduled_for'),
                'scheduled_for',
                422
            );
        }

        return null;
    }
}
