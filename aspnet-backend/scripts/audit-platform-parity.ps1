# Copyright 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

[CmdletBinding()]
param(
    [string]$TargetRoot,
    [string]$SourceRoot,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $TargetRoot = (Resolve-Path (Join-Path $scriptRoot '..')).Path
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $TargetRoot 'artifacts\parity-audit'
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Normalize-RoutePath {
    param([AllowNull()][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return '/'
    }

    $normalized = $Path.Trim().Trim('"', "'")
    $normalized = $normalized -replace '\\', '/'
    $normalized = $normalized -replace '\?.*$', ''
    $normalized = $normalized -replace '\[controller\]', 'controller'
    $normalized = $normalized -replace '\{([A-Za-z0-9_]+)(:[^}]+)?\}', '{$1}'
    $normalized = $normalized -replace ':([A-Za-z0-9_]+)', '{$1}'
    $normalized = $normalized -replace '/+', '/'
    $normalized = $normalized.TrimEnd('/')

    if ($normalized.Length -eq 0) {
        return '/'
    }

    if (-not $normalized.StartsWith('/')) {
        $normalized = "/$normalized"
    }

    return $normalized.ToLowerInvariant()
}

function Convert-ToRouteShape {
    param([string]$Path)
    return (Normalize-RoutePath $Path) -replace '\{[^/]+\}', '{}'
}

function Convert-RouteTemplateToRegex {
    param([string]$Path)

    $token = '___ROUTE_PARAM___'
    $template = (Normalize-RoutePath $Path) -replace '\{[^/}]+\}', $token
    return '^' + ([regex]::Escape($template).Replace($token, '[^/]+')) + '$'
}

function Normalize-FrontendApiPath {
    param([string]$Path)

    $normalized = $Path -replace '^/v2/', '/api/'
    $normalized = $normalized -replace '\$\{?buildQuery.*$', ''
    $normalized = $normalized -replace '(?<!/)\$\{.*$', ''
    $normalized = $normalized -replace '\$\{[^}/]+}', '{id}'
    $normalized = $normalized -replace '\$\{[^/]+$', '{id}'
    $normalized = $normalized -replace '\$\([^)]+\)', '{id}'
    $normalized = $normalized -replace '\$\w+', '{id}'
    return Normalize-RoutePath $normalized
}

function Normalize-V15FrontendApiPath {
    param([string]$Path)

    $normalized = $Path -replace '^/v2/', '/api/v2/'
    $normalized = $normalized -replace '\$\{?buildQuery.*$', ''
    $normalized = $normalized -replace '(?<!/)\$\{.*$', ''
    $normalized = $normalized -replace '\$\{[^}/]+}', '{id}'
    $normalized = $normalized -replace '\$\{[^/]+$', '{id}'
    $normalized = $normalized -replace '\$\([^)]+\)', '{id}'
    $normalized = $normalized -replace '\$\w+', '{id}'
    return Normalize-RoutePath $normalized
}

function Get-FrontendMethodHint {
    param([string]$Line, [int]$MatchIndex)

    $prefix = if ($MatchIndex -gt 0) { $Line.Substring(0, $MatchIndex) } else { '' }
    $methodMatches = [regex]::Matches($prefix, '(?i)(?:\.|\b)(get|post|put|patch|delete|upload|download)\s*(?:<.*>)?\s*\(\s*[''"]?`?$')
    if ($methodMatches.Count -gt 0) {
        $method = $methodMatches[$methodMatches.Count - 1].Groups[1].Value.ToUpperInvariant()
        if ($method -eq 'UPLOAD') { return 'POST' }
        if ($method -eq 'DOWNLOAD') { return 'GET' }
        return $method
    }

    $methodMatches = [regex]::Matches($prefix, '(?i)(?:method\s*:\s*[''"]|method\s*=\s*[''"])(get|post|put|patch|delete)')
    if ($methodMatches.Count -gt 0) {
        return $methodMatches[$methodMatches.Count - 1].Groups[1].Value.ToUpperInvariant()
    }

    if ($prefix -match '(?i)(?:\buseApi\s*(?:<[^)]*>)?\s*\(\s*|window[.]open\s*\(\s*)$') {
        return 'GET'
    }

    return ''
}

function Get-FrontendCallContextMethod {
    param([string]$Line)

    if ($Line -match '(?i)\buseApi\s*(?:<[^)]*>)?\s*\(\s*$') {
        return 'GET'
    }

    $matches = [regex]::Matches($Line, '(?i)(?:api[.])?(get|post|put|patch|delete|upload|download)\s*(?:<.*>)?\s*\(\s*$')
    if ($matches.Count -eq 0) {
        $matches = [regex]::Matches($Line, '(?i)\bapi[.](get|post|put|patch|delete|upload|download)\s*<')
    }
    if ($matches.Count -eq 0) {
        return ''
    }

    $method = $matches[$matches.Count - 1].Groups[1].Value.ToUpperInvariant()
    if ($method -eq 'UPLOAD') { return 'POST' }
    if ($method -eq 'DOWNLOAD') { return 'GET' }
    return $method
}

function Add-FrontendApiStringRow {
    param(
        [System.Collections.Generic.List[object]]$Rows,
        [string]$App,
        [string]$MethodHint,
        [string]$Raw,
        [string]$Normalized,
        [string]$File,
        [int]$Line
    )

    $Rows.Add([pscustomobject]@{
        app = $App
        method_hint = $MethodHint
        raw = $Raw
        normalized = Normalize-RoutePath $Normalized
        file = $File
        line = $Line
    })
}

function Add-V15FrontendApiExpansion {
    param(
        [System.Collections.Generic.List[object]]$Rows,
        [string]$Raw,
        [string]$File,
        [int]$Line,
        [string]$MethodHint
    )

    $fileName = Split-Path -Leaf $File
    if ($fileName -eq 'nav-helpers.ts' -and $Raw -eq '/api/auth/admin-session') {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'POST' $Raw '/api/auth/admin-session' $File $Line
        return $true
    }

    if ($fileName -eq 'PartnerDashboardPage.tsx' -and $Raw.StartsWith('/api/partner-analytics')) {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'GET' '/api/partner-analytics/me/dashboard' '/api/partner-analytics/me/dashboard' $File $Line
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'GET' '/api/partner-analytics/me/reports' '/api/partner-analytics/me/reports' $File $Line
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'GET' '/api/partner-analytics/me/reports/{id}/download' '/api/partner-analytics/me/reports/{id}/download' $File $Line
        return $true
    }

    if ($fileName -eq 'GroupList.tsx' -and $Raw -match '/v2/admin/groups/.+\$\{action\}') {
        $method = if ($MethodHint) { $MethodHint } else { 'POST' }
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' $method '/v2/admin/groups/{id}/archive' '/api/v2/admin/groups/{id}/archive' $File $Line
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' $method '/v2/admin/groups/{id}/unarchive' '/api/v2/admin/groups/{id}/unarchive' $File $Line
        return $true
    }

    if ($fileName -eq 'JobModerationQueue.tsx' -and $Raw -match '/v2/admin/jobs/.+\$\{action\}') {
        $method = if ($MethodHint) { $MethodHint } else { 'POST' }
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' $method '/v2/admin/jobs/{id}/approve' '/api/v2/admin/jobs/{id}/approve' $File $Line
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' $method '/v2/admin/jobs/{id}/reject' '/api/v2/admin/jobs/{id}/reject' $File $Line
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' $method '/v2/admin/jobs/{id}/flag' '/api/v2/admin/jobs/{id}/flag' $File $Line
        return $true
    }

    if ($fileName -eq 'EventsAdmin.tsx' -and $Raw -match '/v2/admin/events/.+\$\{actionModal[.]action\}') {
        foreach ($action in @('approve', 'reject', 'postpone', 'cancel', 'complete', 'archive', 'restore')) {
            Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'POST' $Raw "/api/v2/admin/events/{id}/$action" $File $Line
        }
        return $true
    }

    if ($fileName -eq 'MarketplaceCasesPage.tsx' -and $Raw -match '/v2/admin/marketplace/reports/.+\$\{suffix\}') {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'PUT' $Raw '/api/v2/admin/marketplace/reports/{id}/resolve' $File $Line
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'PUT' $Raw '/api/v2/admin/marketplace/reports/{id}/resolve-appeal' $File $Line
        return $true
    }

    if ($fileName -eq 'analytics.ts' -and $Raw -match '/v2/groups/.+/analytics/export/\$\{type\}') {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'GET' $Raw '/api/v2/groups/{id}/analytics/export/members' $File $Line
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'GET' $Raw '/api/v2/groups/{id}/analytics/export/activity' $File $Line
        return $true
    }

    if ($fileName -eq 'event-tickets-api.ts' -and $Raw -match '/v2/events/.+/ticket-types/.+/\$\{action\}') {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'POST' $Raw '/api/v2/events/{id}/ticket-types/{id}/{action}' $File $Line
        return $true
    }

    if ($fileName -eq 'PrerenderAdmin.tsx' -and $Raw -match '/api/v2/admin/prerender/export/[^/]+[.]csv') {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'GET' $Raw '/api/v2/admin/prerender/export/{kind}.csv' $File $Line
        return $true
    }

    if ($fileName -eq 'adminApi.ts' -and $Raw -eq '/v2/admin/federation/data/export') {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'POST' $Raw '/api/v2/admin/federation/data/export' $File $Line
        return $true
    }

    if ($fileName -eq 'event-registration-api.ts' -and $Raw -match '/registration-product/submissions/export$') {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'POST' $Raw (Normalize-V15FrontendApiPath $Raw) $File $Line
        return $true
    }

    $knownGetVariablePaths = @(
        '/v2/admin/caring-community/sub-regions',
        '/v2/admin/caring-community/surveys?status=${statusFilter}',
        '/v2/admin/caring-community/surveys',
        '/v2/admin/users/import/template',
        '/v2/admin/enterprise/monitoring/log-files/${file.name}?download=1',
        '/v2/connections?status=${status}&per_page=20',
        '/v2/goals?${params}&status=all',
        '/v2/group-exchanges?limit=${ITEMS_PER_PAGE}&offset=${offset}${statusFilter}'
    )
    if ($knownGetVariablePaths -contains $Raw) {
        Add-FrontendApiStringRow $Rows 'react-frontend-v15' 'GET' $Raw (Normalize-V15FrontendApiPath $Raw) $File $Line
        return $true
    }

    return $false
}

function Join-RoutePath {
    param([string]$Prefix, [string]$Child)

    if (-not [string]::IsNullOrWhiteSpace($Child) -and $Child.Trim().StartsWith('/')) {
        return Normalize-RoutePath $Child
    }

    $combined = (($Prefix.Trim('/'), $Child.Trim('/')) | Where-Object { $_ }) -join '/'
    return Normalize-RoutePath $combined
}

function Get-AspNetV2AdminAlias {
    param([string]$Prefix)

    $normalized = Normalize-RoutePath $Prefix
    $aliasedPrefixes = @(
        '/api/admin/caring-community',
        '/api/admin/safeguarding',
        '/api/admin/sso',
        '/api/admin/gamification',
        '/api/admin/identity',
        '/api/admin/enterprise',
        '/api/admin/moderation',
        '/api/admin/tools',
        '/api/admin/polls',
        '/api/admin/resources',
        '/api/admin/goals',
        '/api/admin/ideation',
        '/api/admin/events',
        '/api/admin/members',
        '/api/users',
        '/api/groups',
        '/api/jobs',
        '/api/federation',
        '/api/goals'
    )

    foreach ($aliasedPrefix in $aliasedPrefixes) {
        if ($normalized -eq $aliasedPrefix -or $normalized.StartsWith("$aliasedPrefix/")) {
            if ($aliasedPrefix -eq '/api/users') {
                return $normalized -replace '^/api/users', '/api/v2/users'
            }

            if ($aliasedPrefix -eq '/api/groups') {
                return $normalized -replace '^/api/groups', '/api/v2/groups'
            }

            if ($aliasedPrefix -eq '/api/jobs') {
                return $normalized -replace '^/api/jobs', '/api/v2/jobs'
            }

            if ($aliasedPrefix -eq '/api/federation') {
                return $normalized -replace '^/api/federation', '/api/v2/federation'
            }

            if ($aliasedPrefix -eq '/api/goals') {
                return $normalized -replace '^/api/goals', '/api/v2/goals'
            }

            return $normalized -replace '^/api/admin/', '/api/v2/admin/'
        }
    }

    return ''
}

function Get-AspNetV2RouteAlias {
    param([string]$Path)

    $normalized = Normalize-RoutePath $Path
    if ($normalized -eq '/api/users/me' -or $normalized.StartsWith('/api/users/me/')) {
        return $normalized -replace '^/api/users/me', '/api/v2/users/me'
    }

    if ($normalized -eq '/api/users' -or $normalized.StartsWith('/api/users/')) {
        return $normalized -replace '^/api/users', '/api/v2/users'
    }

    if ($normalized -eq '/api/groups' -or $normalized.StartsWith('/api/groups/')) {
        return $normalized -replace '^/api/groups', '/api/v2/groups'
    }

    if ($normalized -eq '/api/jobs' -or $normalized.StartsWith('/api/jobs/')) {
        return $normalized -replace '^/api/jobs', '/api/v2/jobs'
    }

    if ($normalized -eq '/api/federation' -or $normalized.StartsWith('/api/federation/')) {
        return $normalized -replace '^/api/federation', '/api/v2/federation'
    }

    if ($normalized -eq '/api/goals' -or $normalized.StartsWith('/api/goals/')) {
        return $normalized -replace '^/api/goals', '/api/v2/goals'
    }

    if ($normalized -eq '/api/ideation-challenges' -or $normalized.StartsWith('/api/ideation-challenges/')) {
        return $normalized -replace '^/api/ideation-challenges', '/api/v2/ideation-challenges'
    }

    if ($normalized -eq '/api/ideation-ideas' -or $normalized.StartsWith('/api/ideation-ideas/')) {
        return $normalized -replace '^/api/ideation-ideas', '/api/v2/ideation-ideas'
    }

    if ($normalized -eq '/api/caring-community' -or $normalized.StartsWith('/api/caring-community/')) {
        return $normalized -replace '^/api/caring-community', '/api/v2/caring-community'
    }

    if ($normalized -eq '/api/volunteering' -or $normalized.StartsWith('/api/volunteering/')) {
        return $normalized -replace '^/api/volunteering', '/api/v2/volunteering'
    }

    $simpleV2Prefixes = @(
        '/api/ads/active',
        '/api/admin/audit-log',
        '/api/admin/groups',
        '/api/admin/matching',
        '/api/admin/subscriptions',
        '/api/admin/vetting',
        '/api/appreciations',
        '/api/billing/plans',
        '/api/blog',
        '/api/categories',
        '/api/clubs',
        '/api/community/stats',
        '/api/config',
        '/api/contact',
        '/api/csrf-token',
        '/api/donations',
        '/api/group-collections',
        '/api/group-tags',
        '/api/group-templates',
        '/api/group-chatroom-messages',
        '/api/help/faqs',
        '/api/identity',
        '/api/ideation-outcomes',
        '/api/matches',
        '/api/member-premium',
        '/api/mentions',
        '/api/me/appreciations',
        '/api/me/stats',
        '/api/merchant-onboarding',
        '/api/municipality',
        '/api/newsletter/click',
        '/api/newsletter/pixel',
        '/api/onboarding',
        '/api/pages',
        '/api/pilot-inquiry',
        '/api/platform/stats',
        '/api/pusher/config',
        '/api/realtime/config',
        '/api/safeguarding/my-preferences',
        '/api/safeguarding/revoke',
        '/api/search',
        '/api/seo',
        '/api/skills',
        '/api/team-documents',
        '/api/tenant/bootstrap',
        '/api/ideation-comments',
        '/api/ideation-media',
        '/api/ugc-translate',
        '/api/webhooks'
    )

    foreach ($simplePrefix in $simpleV2Prefixes) {
        if ($normalized -eq $simplePrefix -or $normalized.StartsWith("$simplePrefix/")) {
            return "/api/v2$($normalized.Substring('/api'.Length))"
        }
    }

    if ($normalized -eq '/api/connections' -or $normalized.StartsWith('/api/connections/')) {
        return $normalized -replace '^/api/connections', '/api/v2/connections'
    }

    if ($normalized -eq '/api/stories' -or $normalized.StartsWith('/api/stories/')) {
        return $normalized -replace '^/api/stories', '/api/v2/stories'
    }

    if ($normalized -eq '/api/exchanges' -or $normalized.StartsWith('/api/exchanges/')) {
        return $normalized -replace '^/api/exchanges', '/api/v2/exchanges'
    }

    if ($normalized -eq '/api/group-exchanges' -or $normalized.StartsWith('/api/group-exchanges/')) {
        return $normalized -replace '^/api/group-exchanges', '/api/v2/group-exchanges'
    }

    if ($normalized -eq '/api/messages' -or $normalized.StartsWith('/api/messages/')) {
        return $normalized -replace '^/api/messages', '/api/v2/messages'
    }

    if ($normalized -eq '/api/polls' -or $normalized.StartsWith('/api/polls/')) {
        return $normalized -replace '^/api/polls', '/api/v2/polls'
    }

    if ($normalized -eq '/api/members' -or $normalized.StartsWith('/api/members/')) {
        return $normalized -replace '^/api/members', '/api/v2/members'
    }

    if ($normalized -eq '/api/kb' -or $normalized.StartsWith('/api/kb/')) {
        return $normalized -replace '^/api/kb', '/api/v2/kb'
    }

    if ($normalized -eq '/api/bookmarks' -or $normalized.StartsWith('/api/bookmarks/')) {
        return $normalized -replace '^/api/bookmarks', '/api/v2/bookmarks'
    }

    if ($normalized -eq '/api/bookmark-collections' -or $normalized.StartsWith('/api/bookmark-collections/')) {
        return $normalized -replace '^/api/bookmark-collections', '/api/v2/bookmark-collections'
    }

    if ($normalized -eq '/api/gamification' -or $normalized.StartsWith('/api/gamification/')) {
        return $normalized -replace '^/api/gamification', '/api/v2/gamification'
    }

    if ($normalized -eq '/api/ads/impression' -or $normalized.StartsWith('/api/ads/impression/')) {
        return $normalized -replace '^/api/ads/impression', '/api/v2/ads/impression'
    }

    if ($normalized -eq '/api/ideation-categories' -or $normalized.StartsWith('/api/ideation-categories/')) {
        return $normalized -replace '^/api/ideation-categories', '/api/v2/ideation-categories'
    }

    if ($normalized -eq '/api/ideation-tags' -or $normalized.StartsWith('/api/ideation-tags/')) {
        return $normalized -replace '^/api/ideation-tags', '/api/v2/ideation-tags'
    }

    if ($normalized -eq '/api/legal' -or $normalized.StartsWith('/api/legal/')) {
        return $normalized -replace '^/api/legal', '/api/v2/legal'
    }

    if ($normalized -eq '/api/link-preview' -or $normalized.StartsWith('/api/link-preview/')) {
        return $normalized -replace '^/api/link-preview', '/api/v2/link-preview'
    }

    if ($normalized -eq '/api/newsletter/unsubscribe' -or $normalized.StartsWith('/api/newsletter/unsubscribe/')) {
        return $normalized -replace '^/api/newsletter/unsubscribe', '/api/v2/newsletter/unsubscribe'
    }

    if ($normalized -eq '/api/reactions' -or $normalized.StartsWith('/api/reactions/')) {
        return $normalized -replace '^/api/reactions', '/api/v2/reactions'
    }

    if ($normalized -eq '/api/reviews' -or $normalized.StartsWith('/api/reviews/')) {
        return $normalized -replace '^/api/reviews', '/api/v2/reviews'
    }

    if ($normalized -eq '/api/shares' -or $normalized.StartsWith('/api/shares/')) {
        return $normalized -replace '^/api/shares', '/api/v2/shares'
    }

    if ($normalized -eq '/api/me/collections' -or $normalized.StartsWith('/api/me/collections/')) {
        return $normalized -replace '^/api/me/collections', '/api/v2/me/collections'
    }

    if ($normalized -eq '/api/me/saved-items' -or $normalized.StartsWith('/api/me/saved-items/')) {
        return $normalized -replace '^/api/me/saved-items', '/api/v2/me/saved-items'
    }

    if ($normalized -eq '/api/me/push-campaigns' -or $normalized.StartsWith('/api/me/push-campaigns/')) {
        return $normalized -replace '^/api/me/push-campaigns', '/api/v2/me/push-campaigns'
    }

    if ($normalized -eq '/api/me/ad-campaigns' -or $normalized.StartsWith('/api/me/ad-campaigns/')) {
        return $normalized -replace '^/api/me/ad-campaigns', '/api/v2/me/ad-campaigns'
    }

    if ($normalized -eq '/api/me/verein-dues' -or $normalized.StartsWith('/api/me/verein-dues/')) {
        return $normalized -replace '^/api/me/verein-dues', '/api/v2/me/verein-dues'
    }

    if ($normalized -eq '/api/me/fadp' -or $normalized.StartsWith('/api/me/fadp/')) {
        return $normalized -replace '^/api/me/fadp', '/api/v2/me/fadp'
    }

    if ($normalized -eq '/api/me/residency-verification' -or $normalized.StartsWith('/api/me/residency-verification/')) {
        return $normalized -replace '^/api/me/residency-verification', '/api/v2/me/residency-verification'
    }

    if ($normalized -eq '/api/me/verein-invitations' -or $normalized.StartsWith('/api/me/verein-invitations/')) {
        return $normalized -replace '^/api/me/verein-invitations', '/api/v2/me/verein-invitations'
    }

    if ($normalized -eq '/api/comments' -or $normalized.StartsWith('/api/comments/')) {
        return $normalized -replace '^/api/comments', '/api/v2/comments'
    }

    if ($normalized -eq '/api/resources' -or $normalized.StartsWith('/api/resources/')) {
        return $normalized -replace '^/api/resources', '/api/v2/resources'
    }

    if ($normalized -eq '/api/group-chatrooms' -or $normalized.StartsWith('/api/group-chatrooms/')) {
        return $normalized -replace '^/api/group-chatrooms', '/api/v2/group-chatrooms'
    }

    if ($normalized -eq '/api/team-tasks' -or $normalized.StartsWith('/api/team-tasks/')) {
        return $normalized -replace '^/api/team-tasks', '/api/v2/team-tasks'
    }

    if ($normalized -eq '/api/resources/categories' -or $normalized.StartsWith('/api/resources/categories/')) {
        return $normalized -replace '^/api/resources/categories', '/api/v2/resources/categories'
    }

    if ($normalized -eq '/api/skills/categories' -or $normalized.StartsWith('/api/skills/categories/')) {
        return $normalized -replace '^/api/skills/categories', '/api/v2/skills/categories'
    }

    if ($normalized -eq '/api/search/saved' -or $normalized.StartsWith('/api/search/saved/')) {
        return $normalized -replace '^/api/search/saved', '/api/v2/search/saved'
    }

    if ($normalized -eq '/api/ideation-campaigns' -or $normalized.StartsWith('/api/ideation-campaigns/')) {
        return $normalized -replace '^/api/ideation-campaigns', '/api/v2/ideation-campaigns'
    }

    if ($normalized -eq '/api/ideation-templates' -or $normalized.StartsWith('/api/ideation-templates/')) {
        return $normalized -replace '^/api/ideation-templates', '/api/v2/ideation-templates'
    }

    if ($normalized -eq '/api/auth/2fa' -or $normalized.StartsWith('/api/auth/2fa/')) {
        return $normalized -replace '^/api/auth/2fa', '/api/v2/auth/2fa'
    }

    if ($normalized -eq '/api/auth/oauth' -or $normalized.StartsWith('/api/auth/oauth/')) {
        return $normalized -replace '^/api/auth/oauth', '/api/v2/auth/oauth'
    }

    if ($normalized -eq '/api/admin/reports' -or $normalized.StartsWith('/api/admin/reports/')) {
        return $normalized -replace '^/api/admin/reports', '/api/v2/admin/reports'
    }

    if ($normalized -eq '/api/admin/crm' -or $normalized.StartsWith('/api/admin/crm/')) {
        return $normalized -replace '^/api/admin/crm', '/api/v2/admin/crm'
    }

    if ($normalized -eq '/api/admin/feed' -or $normalized.StartsWith('/api/admin/feed/')) {
        return $normalized -replace '^/api/admin/feed', '/api/v2/admin/feed'
    }

    if ($normalized -eq '/api/admin/pages' -or $normalized.StartsWith('/api/admin/pages/')) {
        return $normalized -replace '^/api/admin/pages', '/api/v2/admin/pages'
    }

    if ($normalized -eq '/api/admin/federation' -or $normalized.StartsWith('/api/admin/federation/')) {
        return $normalized -replace '^/api/admin/federation', '/api/v2/admin/federation'
    }

    if ($normalized -eq '/api/admin/sso' -or $normalized.StartsWith('/api/admin/sso/')) {
        return $normalized -replace '^/api/admin/sso', '/api/v2/admin/sso'
    }

    if ($normalized -eq '/api/admin/gamification' -or $normalized.StartsWith('/api/admin/gamification/')) {
        return $normalized -replace '^/api/admin/gamification', '/api/v2/admin/gamification'
    }

    if ($normalized -eq '/api/admin/identity' -or $normalized.StartsWith('/api/admin/identity/')) {
        return $normalized -replace '^/api/admin/identity', '/api/v2/admin/identity'
    }

    if ($normalized -eq '/api/admin/enterprise' -or $normalized.StartsWith('/api/admin/enterprise/')) {
        return $normalized -replace '^/api/admin/enterprise', '/api/v2/admin/enterprise'
    }

    if ($normalized -eq '/api/admin/moderation' -or $normalized.StartsWith('/api/admin/moderation/')) {
        return $normalized -replace '^/api/admin/moderation', '/api/v2/admin/moderation'
    }

    if ($normalized -eq '/api/admin/tools' -or $normalized.StartsWith('/api/admin/tools/')) {
        return $normalized -replace '^/api/admin/tools', '/api/v2/admin/tools'
    }

    if ($normalized -eq '/api/admin/polls' -or $normalized.StartsWith('/api/admin/polls/')) {
        return $normalized -replace '^/api/admin/polls', '/api/v2/admin/polls'
    }

    if ($normalized -eq '/api/admin/resources' -or $normalized.StartsWith('/api/admin/resources/')) {
        return $normalized -replace '^/api/admin/resources', '/api/v2/admin/resources'
    }

    if ($normalized -eq '/api/admin/goals' -or $normalized.StartsWith('/api/admin/goals/')) {
        return $normalized -replace '^/api/admin/goals', '/api/v2/admin/goals'
    }

    if ($normalized -eq '/api/admin/ideation' -or $normalized.StartsWith('/api/admin/ideation/')) {
        return $normalized -replace '^/api/admin/ideation', '/api/v2/admin/ideation'
    }

    if ($normalized -eq '/api/admin/events' -or $normalized.StartsWith('/api/admin/events/')) {
        return $normalized -replace '^/api/admin/events', '/api/v2/admin/events'
    }

    if ($normalized -eq '/api/admin/members' -or $normalized.StartsWith('/api/admin/members/')) {
        return $normalized -replace '^/api/admin/members', '/api/v2/admin/members'
    }

    return ''
}

function Export-AspNetRoutes {
    param([string]$Root, [string]$Destination)

    $controllerRoot = Join-Path $Root 'src\Nexus.Api\Controllers'
    if (-not (Test-Path -LiteralPath $controllerRoot)) {
        Write-Warning "ASP.NET controller root not found: $controllerRoot"
        return @()
    }

    $rows = New-Object System.Collections.Generic.List[object]
    $httpMap = @{
        HttpGet = 'GET'
        HttpPost = 'POST'
        HttpPut = 'PUT'
        HttpPatch = 'PATCH'
        HttpDelete = 'DELETE'
        HttpHead = 'HEAD'
        HttpOptions = 'OPTIONS'
    }

    Get-ChildItem -LiteralPath $controllerRoot -Recurse -Filter '*.cs' |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } |
        ForEach-Object {
            $file = $_
            $text = Get-Content -LiteralPath $file.FullName -Raw
            $classMatches = [regex]::Matches($text, '(?m)^\s*(?:(?:public|internal)\s+)?(?:(?:sealed|abstract|partial|static)\s+)*class\s+([A-Za-z0-9_]+)\b')
            if ($classMatches.Count -eq 0) {
                $classMatches = @([pscustomobject]@{ Index = 0; Groups = @(@{ Value = $file.BaseName }) })
            }

            for ($classIdx = 0; $classIdx -lt $classMatches.Count; $classIdx++) {
                $classMatch = $classMatches[$classIdx]
                $className = $classMatch.Groups[1].Value
                $controllerName = $className -replace 'Controller$', ''
                $segmentStart = $classMatch.Index
                $segmentEnd = if ($classIdx + 1 -lt $classMatches.Count) { $classMatches[$classIdx + 1].Index } else { $text.Length }
                $segment = $text.Substring($segmentStart, $segmentEnd - $segmentStart)
                $routeConstants = @{}
                foreach ($constantMatch in [regex]::Matches(
                    $segment,
                    '(?m)\bconst\s+string\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"\s*;')) {
                    $routeConstants[$constantMatch.Groups[1].Value] = $constantMatch.Groups[2].Value
                }

                $attributeWindowStart = [Math]::Max(0, $segmentStart - 1500)
                $attributeWindow = $text.Substring($attributeWindowStart, $segmentStart - $attributeWindowStart)
                $routeMatches = [regex]::Matches($attributeWindow, '\[Route\("([^"]+)"\)\]')
                $prefixes = New-Object System.Collections.Generic.List[string]
                foreach ($routeMatch in $routeMatches) {
                    $prefix = $routeMatch.Groups[1].Value -replace '\[controller\]', $controllerName
                    $prefixes.Add($prefix)
                    $alias = Get-AspNetV2AdminAlias $prefix
                    if (-not [string]::IsNullOrWhiteSpace($alias) -and -not $prefixes.Contains($alias.TrimStart('/'))) {
                        $prefixes.Add($alias.TrimStart('/'))
                    }
                }
                if ($prefixes.Count -eq 0) {
                    $prefixes.Add('')
                }

                $lines = $segment -split "`r?`n"
                for ($i = 0; $i -lt $lines.Count; $i++) {
                    $line = $lines[$i]
                    $attributeMatches = [regex]::Matches(
                        $line,
                        '(?:\[|,\s*|^\s*)(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|HttpHead|HttpOptions)(?:\((?:"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*)(?:\s*\+\s*"([^"]*)")?)\))?')
                    if ($attributeMatches.Count -eq 0) { continue }

                    $action = ''
                    $lookAheadEnd = [Math]::Min($i + 10, $lines.Count - 1)
                    for ($j = $i; $j -le $lookAheadEnd; $j++) {
                        $actionMatch = [regex]::Match($lines[$j], '\b(?:async\s+)?(?:Task(?:<[^>]+>)?|IActionResult|ActionResult(?:<[^>]+>)?|[A-Za-z0-9_<>,\?\[\]]+)\s+([A-Za-z0-9_]+)\s*\(')
                        if ($actionMatch.Success) {
                            $action = $actionMatch.Groups[1].Value
                            break
                        }
                    }

                    $authNotes = @()
                    $nearbyStart = [Math]::Max(0, $i - 8)
                    $nearby = ($lines[$nearbyStart..$i] -join "`n")
                    if ($segment -match '\[Authorize' -or $nearby -match '\[Authorize') { $authNotes += 'authorize' }
                    if ($nearby -match '\[AllowAnonymous') { $authNotes += 'allow-anonymous' }

                    foreach ($attributeMatch in $attributeMatches) {
                        $verb = $httpMap[$attributeMatch.Groups[1].Value]
                        $child = $attributeMatch.Groups[2].Value
                        $constantName = $attributeMatch.Groups[3].Value
                        if (-not [string]::IsNullOrWhiteSpace($constantName)) {
                            if (-not $routeConstants.ContainsKey($constantName)) { continue }
                            $child = $routeConstants[$constantName] + $attributeMatch.Groups[4].Value
                        }

                        foreach ($prefix in $prefixes) {
                            $path = Join-RoutePath $prefix $child
                            $rows.Add([pscustomobject]@{
                                method = $verb
                                path = $path
                                controller = $controllerName
                                action = $action
                                file = $file.FullName
                                auth_notes = ($authNotes -join ';')
                            })

                            $aliasPath = Get-AspNetV2RouteAlias $path
                            if (-not [string]::IsNullOrWhiteSpace($aliasPath)) {
                                $rows.Add([pscustomobject]@{
                                    method = $verb
                                    path = $aliasPath
                                    controller = $controllerName
                                    action = $action
                                    file = $file.FullName
                                    auth_notes = ($authNotes -join ';')
                                })
                            }
                        }
                    }
                }
            }
        }

    $uniqueRows = $rows | Sort-Object method, path, controller, action -Unique
    $uniqueRows | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $uniqueRows
}

function Export-LaravelRoutes {
    param([string]$SourceRoot, [string]$Destination)

    $apiFile = Join-Path $SourceRoot 'routes\api.php'
    if (-not (Test-Path -LiteralPath $apiFile)) {
        Write-Warning "Laravel routes file not found: $apiFile"
        return @()
    }

    $rows = New-Object System.Collections.Generic.List[object]
    $text = Get-Content -LiteralPath $apiFile -Raw
    $matches = [regex]::Matches($text, 'Route::(get|post|put|patch|delete|options|any)\s*\(\s*[''"]([^''"]+)[''"]\s*,\s*([^)]+)\)', 'IgnoreCase')

    foreach ($match in $matches) {
        $handler = ($match.Groups[3].Value -replace '\s+', ' ').Trim()
        $routePath = Normalize-RoutePath $match.Groups[2].Value
        if (-not $routePath.StartsWith('/api/')) {
            $routePath = Normalize-RoutePath "/api/$($match.Groups[2].Value)"
        }
        $rows.Add([pscustomobject]@{
            method = $match.Groups[1].Value.ToUpperInvariant()
            path = $routePath
            handler = $handler
            file = $apiFile
        })
    }

    $rows | Sort-Object method, path, handler | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $rows
}

function Export-ReactRoutes {
    param([string]$AppFile, [string]$Destination, [string]$Label)

    if (-not (Test-Path -LiteralPath $AppFile)) {
        Write-Warning "$Label App.tsx not found: $AppFile"
        return @()
    }

    $text = Get-Content -LiteralPath $AppFile -Raw
    $rows = [regex]::Matches($text, '<Route\s+[^>]*path=\{?["'']([^"''}]+)["'']\}?', 'IgnoreCase') |
        ForEach-Object {
            [pscustomobject]@{
                app = $Label
                route = Normalize-RoutePath $_.Groups[1].Value
                file = $AppFile
            }
        } |
        Sort-Object route -Unique

    $rows | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $rows
}

function Convert-NextFileToRoute {
    param([string]$AppRoot, [string]$File)

    $rootUri = [Uri]((Resolve-Path -LiteralPath $AppRoot).Path.TrimEnd('\') + '\')
    $fileUri = [Uri](Resolve-Path -LiteralPath $File).Path
    $relative = [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($fileUri).ToString()) -replace '\\', '/'
    $route = $relative -replace '/(page|route)\.(tsx|ts|jsx|js)$', ''
    $route = $route -replace '\([^)]+\)/?', ''
    $route = $route -replace '\[([^\]]+)\]', '{$1}'
    return Normalize-RoutePath $route
}

function Export-FrontendApiStrings {
    param([string]$Root, [string]$Destination)

    $appSrcs = @(
        'apps\admin\src',
        'apps\web-uk\src'
    )

    $pattern = '(?i)(?:/api|/v2)/[A-Za-z0-9_\-./:{}\[\]$?=&%()!]+'
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($relative in $appSrcs) {
        $src = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $src)) { continue }
        $app = ($relative -split '\\')[1]

        Get-ChildItem -LiteralPath $src -Recurse -Include '*.ts','*.tsx','*.js','*.jsx' -File |
            Where-Object {
                $_.FullName -notmatch '\\(node_modules|dist|build|\.next|coverage|\.claude|__tests__|__mocks__)\\' -and
                $_.Name -notmatch '\.d\.ts$' -and
                $_.Name -notmatch '\.(test|spec)\.(ts|tsx|js|jsx)$'
            } |
            ForEach-Object {
                $file = $_
                $lineNo = 0
                $pendingMethodHint = ''
                $pendingMethodLines = 0
                Get-Content -LiteralPath $file.FullName | ForEach-Object {
                    $lineNo++
                    $trimmed = $_.TrimStart()
                    if (-not ($trimmed.StartsWith('//') -or $trimmed.StartsWith('*') -or $trimmed.StartsWith('{/*'))) {
                        $lineMethodContext = $pendingMethodHint
                        if ($pendingMethodLines -gt 0) {
                            $pendingMethodLines--
                        } else {
                            $pendingMethodHint = ''
                        }
                        $commentIndex = $_.IndexOf('//')
                        foreach ($match in [regex]::Matches($_, $pattern)) {
                            $skip = $false
                            if ($commentIndex -ge 0 -and $match.Index -gt $commentIndex) {
                                $skip = $true
                            }
                            if ($match.Index -gt 0) {
                                $previous = $_[$match.Index - 1]
                                if ($previous -match '[A-Za-z0-9_.@-]') {
                                    $skip = $true
                                }
                            }
                            if (-not $skip) {
                                $raw = $match.Value.TrimEnd("'", '"', '`', ',', '.', ')')
                                $normalizedPath = Normalize-FrontendApiPath $raw
                                $methodHint = Get-FrontendMethodHint $_ $match.Index
                                if (-not $methodHint) { $methodHint = $lineMethodContext }
                                $suffix = $_.Substring($match.Index + $match.Length)
                                if ($normalizedPath.EndsWith('/') -or $raw.EndsWith('/')) {
                                    if ($suffix -match '^\s*[''"]?\s*\+\s*[A-Za-z_][A-Za-z0-9_]*') {
                                        $normalizedPath = Normalize-RoutePath "$normalizedPath/{id}"
                                    }
                                }
                                $rows.Add([pscustomobject]@{
                                    app = $app
                                    method_hint = $methodHint
                                    raw = $raw
                                    normalized = $normalizedPath
                                    file = $file.FullName
                                    line = $lineNo
                                })
                            }
                        }
                        $newMethodContext = Get-FrontendCallContextMethod $_
                        if ($newMethodContext) {
                            $pendingMethodHint = $newMethodContext
                            $pendingMethodLines = 4
                        }
                    }
                }
            }
    }

    $rows | Sort-Object app, normalized, file, line | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $rows
}

function Export-V15FrontendApiStrings {
    param([string]$SourceRoot, [string]$Destination)

    $src = Join-Path $SourceRoot 'react-frontend\src'
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Warning "Laravel React frontend src not found: $src"
        return @()
    }

    $pattern = '(?i)(?:/api/v2|/api|/v2)/[A-Za-z0-9_\-./:{}\[\]$?=&%()!]+'
    $rows = New-Object System.Collections.Generic.List[object]

    Get-ChildItem -LiteralPath $src -Recurse -Include '*.ts','*.tsx','*.js','*.jsx' -File |
        Where-Object {
            $_.FullName -notmatch '\\(node_modules|dist|build|\.next|coverage|\.claude|__tests__|__mocks__)\\' -and
            $_.Name -notmatch '\.d\.ts$' -and
            $_.Name -ne 'ApiDocumentation.tsx' -and
            $_.Name -notmatch '\.(test|spec)\.(ts|tsx|js|jsx)$'
        } |
        ForEach-Object {
            $file = $_
            $lineNo = 0
            $pendingMethodHint = ''
            $pendingMethodLines = 0
            Get-Content -LiteralPath $file.FullName | ForEach-Object {
                $lineNo++
                $trimmed = $_.TrimStart()
                if (-not ($trimmed.StartsWith('//') -or $trimmed.StartsWith('*') -or $trimmed.StartsWith('{/*'))) {
                    $lineMethodContext = $pendingMethodHint
                    if ($pendingMethodLines -gt 0) {
                        $pendingMethodLines--
                    } else {
                        $pendingMethodHint = ''
                    }
                    $commentIndex = $_.IndexOf('//')
                    foreach ($match in [regex]::Matches($_, $pattern)) {
                        $skip = $false
                        if ($commentIndex -ge 0 -and $match.Index -gt $commentIndex) {
                            $skip = $true
                        }
                        if ($match.Index -gt 0) {
                            $previous = $_[$match.Index - 1]
                            if ($previous -match '[A-Za-z0-9_.@-]') {
                                $skip = $true
                            }
                        }
                        if (-not $skip) {
                            $raw = $match.Value.TrimEnd("'", '"', '`', ',', '.', ')')
                            if ($file.Name -eq 'ExternalPartners.tsx' -and $_ -match '^\s*(nexus|timeoverflow|komunitin):\s*[''"]') {
                                $skip = $true
                            }
                            if ($file.Name -eq 'RegionalAnalyticsPage.tsx' -and $_ -match '^\s*const\s+BASE\s*=') {
                                $skip = $true
                            }
                            if (-not $skip) {
                                $methodHint = Get-FrontendMethodHint $_ $match.Index
                                if (-not $methodHint) { $methodHint = $lineMethodContext }
                                $expanded = Add-V15FrontendApiExpansion $rows $raw $file.FullName $lineNo $methodHint
                                if (-not $expanded) {
                                    $normalizedPath = Normalize-V15FrontendApiPath $raw
                                    $suffix = $_.Substring($match.Index + $match.Length)
                                    if ($normalizedPath.EndsWith('/') -or $raw.EndsWith('/')) {
                                        if ($suffix -match '^\s*[''"]?\s*\+\s*[A-Za-z_][A-Za-z0-9_]*') {
                                            $normalizedPath = Normalize-RoutePath "$normalizedPath/{id}"
                                        }
                                    }
                                    Add-FrontendApiStringRow $rows 'react-frontend-v15' $methodHint $raw $normalizedPath $file.FullName $lineNo
                                }
                            }
                        }
                    }
                    $newMethodContext = Get-FrontendCallContextMethod $_
                    if ($newMethodContext) {
                        $pendingMethodHint = $newMethodContext
                        $pendingMethodLines = 4
                    }
                }
            }
        }

    $rows | Sort-Object normalized, file, line | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $rows
}

function New-RouteIndex {
    param([object[]]$Routes)

    $byPath = @{}
    $byMethodPath = @{}
    $byShape = @{}
    $byMethodShape = @{}
    $templateRoutes = New-Object System.Collections.Generic.List[object]
    $templatesBySegmentCount = @{}

    foreach ($route in $Routes) {
        $path = Normalize-RoutePath $route.path
        $shape = Convert-ToRouteShape $path
        $method = ([string]$route.method).ToUpperInvariant()
        if ($path -match '\{[^/}]+\}') {
            $templateRoutes.Add($route)
            $templateSegmentCount = @($path.Trim('/') -split '/').Count
            if (-not $templatesBySegmentCount.ContainsKey($templateSegmentCount)) {
                $templatesBySegmentCount[$templateSegmentCount] = New-Object System.Collections.Generic.List[object]
            }
            $templatesBySegmentCount[$templateSegmentCount].Add($route)
        }
        if (-not $byPath.ContainsKey($path)) {
            $byPath[$path] = New-Object System.Collections.Generic.List[object]
        }
        $byPath[$path].Add($route)

        if (-not $byShape.ContainsKey($shape)) {
            $byShape[$shape] = New-Object System.Collections.Generic.List[object]
        }
        $byShape[$shape].Add($route)

        $key = "$method $path"
        if (-not $byMethodPath.ContainsKey($key)) {
            $byMethodPath[$key] = New-Object System.Collections.Generic.List[object]
        }
        $byMethodPath[$key].Add($route)

        $shapeKey = "$method $shape"
        if (-not $byMethodShape.ContainsKey($shapeKey)) {
            $byMethodShape[$shapeKey] = New-Object System.Collections.Generic.List[object]
        }
        $byMethodShape[$shapeKey].Add($route)
    }

    return @{
        ByPath = $byPath
        ByShape = $byShape
        ByMethodPath = $byMethodPath
        ByMethodShape = $byMethodShape
        TemplateRoutes = $templateRoutes.ToArray()
        TemplatesBySegmentCount = $templatesBySegmentCount
    }
}

function Test-UnresolvedTemplate {
    param([string]$Path)
    return $Path -match '\$\{|\$\(|\+|`'
}

function Get-RouteIndexMatches {
    param([hashtable]$Index, [string]$Bucket, [string]$Key)

    if (-not $Index[$Bucket].ContainsKey($Key)) {
        return @()
    }

    $items = New-Object System.Collections.Generic.List[object]
    foreach ($item in $Index[$Bucket][$Key]) {
        $items.Add($item)
    }
    return $items.ToArray()
}

function Get-RouteTemplateMatches {
    param([hashtable]$Index, [string]$Path, [string]$MethodHint)

    $items = New-Object System.Collections.Generic.List[object]
    $normalizedPath = Normalize-RoutePath $Path
    $segmentCount = @($normalizedPath.Trim('/') -split '/').Count
    if (-not $Index.TemplatesBySegmentCount.ContainsKey($segmentCount)) {
        return @()
    }
    foreach ($route in $Index.TemplatesBySegmentCount[$segmentCount]) {
        $routeMethod = ([string]$route.method).ToUpperInvariant()
        if ($MethodHint -and $routeMethod -ne $MethodHint) {
            continue
        }

        $routePath = Normalize-RoutePath $route.path
        $templateStart = $routePath.IndexOf('{')
        if ($templateStart -gt 0) {
            $staticPrefix = $routePath.Substring(0, $templateStart)
            if (-not $normalizedPath.StartsWith($staticPrefix, [StringComparison]::Ordinal)) {
                continue
            }
        }

        $regex = Convert-RouteTemplateToRegex $routePath
        if ($normalizedPath -match $regex) {
            $items.Add($route)
        }
    }

    return $items.ToArray()
}

function Export-FrontendApiMatrix {
    param(
        [object[]]$ApiStrings,
        [hashtable]$AspNetIndex,
        [hashtable]$LaravelIndex,
        [string]$Destination
    )

    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($apiString in $ApiStrings) {
        $path = Normalize-RoutePath $apiString.normalized
        $methodHint = ([string]$apiString.method_hint).ToUpperInvariant()
        $routeMatches = @()
        $status = 'missing'
        $methodKey = "$methodHint $path"
        $methodShapeKey = "$methodHint $(Convert-ToRouteShape $path)"

        if (Test-UnresolvedTemplate $path) {
            $status = 'dynamic-unresolved'
        } elseif ($methodHint -and $AspNetIndex.ByMethodPath.ContainsKey($methodKey)) {
            $routeMatches = Get-RouteIndexMatches $AspNetIndex 'ByMethodPath' $methodKey
            $controllers = ($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';'
            if ($controllers -match 'Compatibility') {
                $status = 'exists-compatibility'
            } else {
                $status = 'exists'
            }
        } elseif ($methodHint -and $AspNetIndex.ByMethodShape.ContainsKey($methodShapeKey)) {
            $routeMatches = Get-RouteIndexMatches $AspNetIndex 'ByMethodShape' $methodShapeKey
            $controllers = ($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';'
            if ($controllers -match 'Compatibility') {
                $status = 'exists-compatibility'
            } else {
                $status = 'exists'
            }
        } elseif ($AspNetIndex.ByPath.ContainsKey($path)) {
            $routeMatches = Get-RouteIndexMatches $AspNetIndex 'ByPath' $path
            $controllers = ($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';'
            if ($controllers -match 'Compatibility') {
                $status = 'exists-compatibility'
            } else {
                $methods = @($routeMatches | ForEach-Object { $_.method } | Sort-Object -Unique)
                $status = if ($methodHint) { 'method-mismatch' } elseif ($methods.Count -eq 1) { 'exists-unambiguous-method' } else { 'exists-any-method' }
            }
        } elseif ($AspNetIndex.ByShape.ContainsKey((Convert-ToRouteShape $path))) {
            $routeMatches = Get-RouteIndexMatches $AspNetIndex 'ByShape' (Convert-ToRouteShape $path)
            $controllers = ($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';'
            if ($controllers -match 'Compatibility') {
                $status = 'exists-compatibility'
            } else {
                $methods = @($routeMatches | ForEach-Object { $_.method } | Sort-Object -Unique)
                $status = if ($methodHint) { 'method-mismatch' } elseif ($methods.Count -eq 1) { 'exists-unambiguous-method' } else { 'exists-any-method' }
            }
        } else {
            $routeMatches = Get-RouteTemplateMatches $AspNetIndex $path $methodHint
            if ($routeMatches.Count -gt 0) {
                $controllers = ($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';'
                if ($controllers -match 'Compatibility') {
                    $status = 'exists-compatibility'
                } else {
                    $methods = @($routeMatches | ForEach-Object { $_.method } | Sort-Object -Unique)
                    $status = if ($methodHint) { 'exists' } elseif ($methods.Count -eq 1) { 'exists-unambiguous-method' } else { 'exists-any-method' }
                }
            }
        }

        $laravelMatches = @()
        $laravelStatus = 'missing'
        if (Test-UnresolvedTemplate $path) {
            $laravelStatus = 'dynamic-unresolved'
        } elseif ($methodHint -and $LaravelIndex.ByMethodPath.ContainsKey($methodKey)) {
            $laravelMatches = Get-RouteIndexMatches $LaravelIndex 'ByMethodPath' $methodKey
            $laravelStatus = 'exists'
        } elseif ($methodHint -and $LaravelIndex.ByMethodShape.ContainsKey($methodShapeKey)) {
            $laravelMatches = Get-RouteIndexMatches $LaravelIndex 'ByMethodShape' $methodShapeKey
            $laravelStatus = 'exists'
        } elseif ($LaravelIndex.ByPath.ContainsKey($path)) {
            $laravelMatches = Get-RouteIndexMatches $LaravelIndex 'ByPath' $path
            $laravelMethods = @($laravelMatches | ForEach-Object { $_.method } | Sort-Object -Unique)
            $laravelStatus = if ($methodHint) { 'method-mismatch' } elseif ($laravelMethods.Count -eq 1) { 'exists-unambiguous-method' } else { 'exists-any-method' }
        } elseif ($LaravelIndex.ByShape.ContainsKey((Convert-ToRouteShape $path))) {
            $laravelMatches = Get-RouteIndexMatches $LaravelIndex 'ByShape' (Convert-ToRouteShape $path)
            $laravelMethods = @($laravelMatches | ForEach-Object { $_.method } | Sort-Object -Unique)
            $laravelStatus = if ($methodHint) { 'method-mismatch' } elseif ($laravelMethods.Count -eq 1) { 'exists-unambiguous-method' } else { 'exists-any-method' }
        } else {
            $laravelMatches = Get-RouteTemplateMatches $LaravelIndex $path $methodHint
            if ($laravelMatches.Count -gt 0) {
                $laravelMethods = @($laravelMatches | ForEach-Object { $_.method } | Sort-Object -Unique)
                $laravelStatus = if ($methodHint) { 'exists' } elseif ($laravelMethods.Count -eq 1) { 'exists-unambiguous-method' } else { 'exists-any-method' }
            }
        }

        $rows.Add([pscustomobject]@{
            app = $apiString.app
            method_hint = $methodHint
            raw = $apiString.raw
            normalized = $path
            laravel_status = $laravelStatus
            laravel_methods = (($laravelMatches | ForEach-Object { $_.method } | Sort-Object -Unique) -join ';')
            laravel_handlers = (($laravelMatches | ForEach-Object { $_.handler } | Sort-Object -Unique) -join ';')
            status = $status
            aspnet_methods = (($routeMatches | ForEach-Object { $_.method } | Sort-Object -Unique) -join ';')
            aspnet_controllers = (($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';')
            frontend_file = $apiString.file
            frontend_line = $apiString.line
        })
    }

    $rows | Sort-Object app, status, normalized, frontend_file, frontend_line | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $rows
}

function Export-LaravelToAspNetMatrix {
    param([object[]]$LaravelRoutes, [hashtable]$AspNetIndex, [string]$Destination)

    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($route in $LaravelRoutes) {
        $path = Normalize-RoutePath $route.path
        $method = ([string]$route.method).ToUpperInvariant()
        $methodKey = "$method $path"
        $methodShapeKey = "$method $(Convert-ToRouteShape $path)"
        $routeMatches = @()
        $status = 'missing'

        if ($AspNetIndex.ByMethodPath.ContainsKey($methodKey)) {
            $routeMatches = Get-RouteIndexMatches $AspNetIndex 'ByMethodPath' $methodKey
            $controllers = ($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';'
            $status = if ($controllers -match 'Compatibility') { 'method-path-compatibility' } else { 'method-path-exact' }
        } elseif ($AspNetIndex.ByMethodShape.ContainsKey($methodShapeKey)) {
            $routeMatches = Get-RouteIndexMatches $AspNetIndex 'ByMethodShape' $methodShapeKey
            $controllers = ($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';'
            $status = if ($controllers -match 'Compatibility') { 'method-path-compatibility' } else { 'method-path-exact' }
        } elseif ($AspNetIndex.ByPath.ContainsKey($path)) {
            $routeMatches = Get-RouteIndexMatches $AspNetIndex 'ByPath' $path
            $status = 'path-exists-method-mismatch'
        }

        $rows.Add([pscustomobject]@{
            v15_method = $method
            v15_path = $path
            v15_handler = $route.handler
            status = $status
            aspnet_methods = (($routeMatches | ForEach-Object { $_.method } | Sort-Object -Unique) -join ';')
            aspnet_controllers = (($routeMatches | ForEach-Object { $_.controller } | Sort-Object -Unique) -join ';')
            aspnet_actions = (($routeMatches | ForEach-Object { $_.action } | Sort-Object -Unique) -join ';')
        })
    }

    $rows | Sort-Object status, v15_method, v15_path | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $rows
}

function Export-FrontendRouteParityMatrix {
    param([object[]]$V15Routes, [object[]]$CurrentReactRoutes, [string]$Destination)

    $currentSet = @{}
    foreach ($route in $CurrentReactRoutes) {
        $currentSet[(Normalize-RoutePath $route.route)] = $true
    }

    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($route in $V15Routes) {
        $path = Normalize-RoutePath $route.route
        $hasCurrent = $currentSet.ContainsKey($path)
        $status = if ($hasCurrent) {
            'current-react-exact'
        } else {
            'missing'
        }

        $rows.Add([pscustomobject]@{
            v15_route = $path
            current_react_route = if ($hasCurrent) { $path } else { '' }
            status = $status
        })
    }

    $rows | Sort-Object status, v15_route | Export-Csv -LiteralPath $Destination -NoTypeInformation
    return $rows
}

Ensure-Directory $OutDir

$aspNetRoutes = Export-AspNetRoutes $TargetRoot (Join-Path $OutDir 'aspnet-routes.csv')
$laravelRoutes = Export-LaravelRoutes $SourceRoot (Join-Path $OutDir 'v15-laravel-routes.csv')
$currentReactRoutes = Export-ReactRoutes (Join-Path $TargetRoot 'apps\react-frontend\src\App.tsx') (Join-Path $OutDir 'react-routes-current.csv') 'react-frontend-current'
$v15ReactRoutes = Export-ReactRoutes (Join-Path $SourceRoot 'react-frontend\src\App.tsx') (Join-Path $OutDir 'react-routes-v15.csv') 'react-frontend-v15'
$frontendApiStrings = Export-FrontendApiStrings $TargetRoot (Join-Path $OutDir 'frontend-api-strings.csv')
$v15FrontendApiStrings = Export-V15FrontendApiStrings $SourceRoot (Join-Path $OutDir 'v15-frontend-api-strings.csv')
$aspNetIndex = New-RouteIndex $aspNetRoutes
$laravelIndex = New-RouteIndex $laravelRoutes
$frontendApiMatrix = Export-FrontendApiMatrix $frontendApiStrings $aspNetIndex $laravelIndex (Join-Path $OutDir 'frontend-api-to-aspnet-matrix.csv')
$v15FrontendApiMatrix = Export-FrontendApiMatrix $v15FrontendApiStrings $aspNetIndex $laravelIndex (Join-Path $OutDir 'v15-frontend-api-to-aspnet-matrix.csv')
$laravelMatrix = Export-LaravelToAspNetMatrix $laravelRoutes $aspNetIndex (Join-Path $OutDir 'v15-laravel-to-aspnet-matrix.csv')
$routeParityMatrix = Export-FrontendRouteParityMatrix $v15ReactRoutes $currentReactRoutes (Join-Path $OutDir 'frontend-route-parity-matrix.csv')

$summary = [pscustomobject]@{
    generated_at = (Get-Date).ToString('o')
    target_root = $TargetRoot
    source_root = $SourceRoot
    aspnet_routes = $aspNetRoutes.Count
    v15_laravel_routes = $laravelRoutes.Count
    current_react_routes = $currentReactRoutes.Count
    v15_react_routes = $v15ReactRoutes.Count
    frontend_api_strings = $frontendApiStrings.Count
    frontend_api_missing = @($frontendApiMatrix | Where-Object { $_.status -eq 'missing' }).Count
    frontend_api_dynamic_unresolved = @($frontendApiMatrix | Where-Object { $_.status -eq 'dynamic-unresolved' }).Count
    v15_frontend_api_strings = $v15FrontendApiStrings.Count
    v15_frontend_api_missing = @($v15FrontendApiMatrix | Where-Object { $_.status -eq 'missing' }).Count
    v15_frontend_laravel_missing = @($v15FrontendApiMatrix | Where-Object { $_.laravel_status -eq 'missing' }).Count
    v15_frontend_api_dynamic_unresolved = @($v15FrontendApiMatrix | Where-Object { $_.status -eq 'dynamic-unresolved' }).Count
    v15_laravel_missing = @($laravelMatrix | Where-Object { $_.status -eq 'missing' }).Count
    v15_routes_missing = @($routeParityMatrix | Where-Object { $_.status -eq 'missing' }).Count
}

$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutDir 'summary.json')
$summary | Format-List

Write-Host "Parity audit artifacts written to $OutDir"
