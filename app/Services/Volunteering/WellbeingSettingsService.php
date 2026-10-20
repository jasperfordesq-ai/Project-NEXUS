<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Volunteering;

use App\Services\TenantSettingsService;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;

/**
 * A community's wellbeing settings (owner decisions, 20 Oct 2026):
 *
 *  - who is told FIRST when a volunteer says they are Low or Struggling and
 *    asks for someone to get in touch: up to ten members of this community
 *    (`volunteering.wellbeing_contact_user_ids`) and one extra address
 *    (`volunteering.wellbeing_contact_email`);
 *  - the "need support now" box every volunteer sees on the wellbeing page
 *    (`volunteering.wellbeing_support_text`, `volunteering.wellbeing_support_links`),
 *    with a default that just says to contact the community's team.
 *
 * Stored in tenant_settings. Community administrators manage them; brokers
 * read alerts but never these. Contact ids are validated against THIS
 * community (tenant isolation): an id from anywhere else is refused, never
 * silently dropped, so an administrator learns the pick was wrong.
 */
final class WellbeingSettingsService
{
    public const KEY_CONTACT_IDS = WellbeingRecipientResolver::SETTING_CONTACT_IDS;
    public const KEY_CONTACT_EMAIL = WellbeingRecipientResolver::SETTING_CONTACT_EMAIL;
    public const KEY_SUPPORT_TEXT = 'volunteering.wellbeing_support_text';
    public const KEY_SUPPORT_LINKS = 'volunteering.wellbeing_support_links';

    public const MAX_CONTACTS = 10;
    public const MAX_SUPPORT_TEXT = 2000;
    public const MAX_LINKS = 5;
    public const MAX_LABEL = 80;
    public const MAX_URL = 500;

    public function __construct(private readonly TenantSettingsService $settings)
    {
    }

    /**
     * @return array{
     *   contact_user_ids: list<int>, contacts: list<array{id: int, name: string}>,
     *   contact_email: ?string, support_text: string, support_links: list<array{label: string, url: string}>,
     *   defaults: array{support_text: string, support_links: list<array{label: string, url: string}>}
     * }
     */
    public function get(int $tenantId): array
    {
        $ids = WellbeingRecipientResolver::contactIds($tenantId);
        $contacts = [];
        if ($ids !== []) {
            $rows = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $ids)
                ->get(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name', 'status'])
                ->keyBy('id');
            foreach ($ids as $id) {
                $row = $rows->get($id);
                if ($row) {
                    $contacts[] = ['id' => (int) $row->id, 'name' => UserDisplayName::person($row), 'status' => (string) $row->status];
                }
            }
        }

        return [
            'contact_user_ids' => $ids,
            'contacts' => $contacts,
            'contact_email' => WellbeingRecipientResolver::contactEmail($tenantId),
            'support_text' => $this->supportText($tenantId),
            'support_links' => $this->supportLinks($tenantId),
            'defaults' => $this->defaults(),
        ];
    }

    /**
     * What the volunteer's wellbeing page shows under "If you need support now".
     *
     * @return array{text: string, links: list<array{label: string, url: string}>, is_default: bool}
     */
    public function supportBox(int $tenantId): array
    {
        $text = $this->supportText($tenantId);
        $links = $this->supportLinks($tenantId);
        $isDefault = $text === '' && $links === [];
        if ($isDefault) {
            $defaults = $this->defaults();
            $text = $defaults['support_text'];
            $links = $defaults['support_links'];
        }

        return ['text' => $text, 'links' => $links, 'is_default' => $isDefault];
    }

    /**
     * Validate and save. Keys absent from $input are left alone.
     *
     * @param array<string, mixed> $input
     * @return array{field: string, reason: string}|null a refusal, or null when saved
     */
    public function save(int $tenantId, array $input): ?array
    {
        $writes = [];

        if (array_key_exists('contact_user_ids', $input)) {
            $raw = $input['contact_user_ids'];
            if (!is_array($raw)) {
                return ['field' => 'contact_user_ids', 'reason' => 'invalid'];
            }
            $ids = array_values(array_unique(array_map('intval', array_filter($raw, 'is_numeric'))));
            if (count($ids) !== count($raw) || count($ids) > self::MAX_CONTACTS) {
                return ['field' => 'contact_user_ids', 'reason' => count($ids) > self::MAX_CONTACTS ? 'too_many' : 'invalid'];
            }
            if ($ids !== []) {
                $active = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'active')
                    ->whereIn('id', $ids)
                    ->count();
                if ($active !== count($ids)) {
                    return ['field' => 'contact_user_ids', 'reason' => 'not_in_community'];
                }
            }
            $writes[self::KEY_CONTACT_IDS] = [json_encode($ids), 'json'];
        }

        if (array_key_exists('contact_email', $input)) {
            $email = $input['contact_email'];
            if ($email === null || (is_string($email) && trim($email) === '')) {
                $writes[self::KEY_CONTACT_EMAIL] = ['', 'string'];
            } else {
                if (!is_string($email)) {
                    return ['field' => 'contact_email', 'reason' => 'invalid'];
                }
                $email = mb_strtolower(trim($email));
                if (mb_strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    return ['field' => 'contact_email', 'reason' => 'invalid'];
                }
                $writes[self::KEY_CONTACT_EMAIL] = [$email, 'string'];
            }
        }

        if (array_key_exists('support_text', $input)) {
            $text = $input['support_text'];
            if ($text !== null && !is_string($text)) {
                return ['field' => 'support_text', 'reason' => 'invalid'];
            }
            $text = trim(strip_tags((string) $text));
            if (mb_strlen($text) > self::MAX_SUPPORT_TEXT) {
                return ['field' => 'support_text', 'reason' => 'too_long'];
            }
            $writes[self::KEY_SUPPORT_TEXT] = [$text, 'string'];
        }

        if (array_key_exists('support_links', $input)) {
            $raw = $input['support_links'];
            if ($raw === null) {
                $raw = [];
            }
            if (!is_array($raw)) {
                return ['field' => 'support_links', 'reason' => 'invalid'];
            }
            if (count($raw) > self::MAX_LINKS) {
                return ['field' => 'support_links', 'reason' => 'too_many'];
            }
            $links = [];
            foreach ($raw as $row) {
                $label = is_array($row) && is_string($row['label'] ?? null) ? trim(strip_tags($row['label'])) : '';
                $url = is_array($row) && is_string($row['url'] ?? null) ? trim($row['url']) : '';
                if ($label === '' || mb_strlen($label) > self::MAX_LABEL || !self::isSafeLink($url)) {
                    return ['field' => 'support_links', 'reason' => 'invalid'];
                }
                $links[] = ['label' => $label, 'url' => $url];
            }
            $writes[self::KEY_SUPPORT_LINKS] = [json_encode($links), 'json'];
        }

        foreach ($writes as $key => [$value, $type]) {
            $this->settings->set($tenantId, $key, $value, $type);
        }
        $this->settings->clearCacheForTenant($tenantId);
        try {
            app(\App\Services\RedisCache::class)->delete('tenant_bootstrap', $tenantId);
        } catch (\Throwable $e) {
            // Bootstrap cache is a convenience; the settings are already saved.
        }

        return null;
    }

    /** https://, mailto:, tel:, or a path inside this platform. Never javascript:, never plain http. */
    public static function isSafeLink(string $url): bool
    {
        if ($url === '' || mb_strlen($url) > self::MAX_URL || preg_match('/[\x00-\x1F\x7F\s]/', $url)) {
            return false;
        }
        if (str_starts_with($url, '/') && !str_starts_with($url, '//')) {
            return true;
        }

        return (bool) preg_match('#^(https://[^\s]+|mailto:[^\s@]+@[^\s@]+|tel:\+?[0-9][0-9 ().-]{2,})$#i', $url);
    }

    /** @return array{support_text: string, support_links: list<array{label: string, url: string}>} */
    private function defaults(): array
    {
        return [
            'support_text' => (string) __('api.vol_wellbeing_support_default'),
            'support_links' => [
                ['label' => (string) __('api.vol_wellbeing_support_contact_team'), 'url' => '/contact'],
            ],
        ];
    }

    private function supportText(int $tenantId): string
    {
        $value = $this->settings->get($tenantId, self::KEY_SUPPORT_TEXT, '');

        return is_string($value) ? trim($value) : '';
    }

    /** @return list<array{label: string, url: string}> */
    private function supportLinks(int $tenantId): array
    {
        $raw = $this->settings->get($tenantId, self::KEY_SUPPORT_LINKS, null);
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;
        if (!is_array($decoded)) {
            return [];
        }
        $links = [];
        foreach ($decoded as $row) {
            if (is_array($row) && is_string($row['label'] ?? null) && is_string($row['url'] ?? null) && self::isSafeLink($row['url'])) {
                $links[] = ['label' => $row['label'], 'url' => $row['url']];
            }
        }

        return $links;
    }
}
