# Copyright (c) 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

<#
.SYNOPSIS
    Counts endpoints that answer a caller successfully while doing none of the
    endpoint's work. Shrink-only ratchet, per category.

.DESCRIPTION
    An endpoint that answers 200 with plausible JSON while performing no work is
    the most damaging defect class in this backend, and the reason every
    route-level comparison reported near-total parity: the routes exist and
    answer, so an inventory sees success. `AdminV2RouteAliasRuntimeTests.cs`
    asserts only "not 404, not 405", which such an endpoint satisfies.

    !! WHY THIS SCRIPT WAS REWRITTEN ON 2026-08-21. Until that date it counted
    ONE thing - a method whose body contains no data access - and reported ONE
    number (316). An admin measurement pass
    (docs/generated/admin-corpus/README.md) established that this saw only a
    fraction of the do-nothing surface. In the admin area alone there are three
    distinct kinds and the old scanner recognised one:

        108  plain no-op method                       VISIBLE
        138  dispatcher fall-through to an echo store  INVISIBLE
          6  hardcoded payload behind real auth        INVISIBLE

    The invisible 138 are the important finding. `AdminExplicitParityController`
    carries five catch-all actions (Delete/Get/Patch/Post/Put) that switch on
    `Request.Path`. 321 routes are declared across them; 144 have an explicit
    branch and 177 fall through to the default arm,
    `PersistCompatibilityWrite` / `GetPersistedCompatibilityRead`. That default
    records the request body in `CompatibilityAuditEntries` and answers 202 with
    `side_effect = "recorded_only"`; the matching read replays it. It touches
    the database, so the old "does this body do work?" heuristic PASSED it -
    yet nothing is moderated, sent, applied or deleted.

    On top of that the count was in the wrong UNIT. It counted METHODS while a
    client calls ROUTES, and one method can carry many:
    `ReactFrontendCompatibilityController.AdminEmptyData` carries six `[Http*]`
    attributes. The 316 flagged methods carry 375 routes, so 59 client-callable
    do-nothing endpoints were invisible to the number and to
    `build-stub-route-inventory.mjs`, which recorded one route per method. That
    undercount is how two exchange endpoints were once reported clean while
    being served by `AdminEmptyData`.

.DESCRIPTION_CATEGORIES
    FOUR categories are reported, each with its own shrink-only baseline. They
    are kept SEPARATE rather than summed into one widened number for three
    reasons, each learned here:

      1. One number lets a fix in one category mask a regression in another.
         Repair 20 plain no-ops, add 20 dispatcher fall-throughs, and a single
         total stays flat and green while the product got no better. That is
         precisely the class of instrument this project has been burned by.
      2. The detectors have very different trust levels. `noop_method` is a
         syntactic rule over every controller. `echo_store` is an exact
         structural rule over one controller. `hardcoded_payload` has no static
         rule at all and is a hand-read floor. Averaging a mechanical count into
         a hand-curated one makes neither auditable.
      3. Remediation differs per category, so the schedule needs them apart.

      noop_method        The body performs no data access and no delegation, and
                         it answers success-shaped. Syntactic, all controllers.
      echo_store         A route declared on an `AdminExplicitParityController`
                         catch-all dispatcher with no matching switch branch, so
                         it falls through to the generic echo store.
      hardcoded_payload  Real authorisation/database work followed by a
                         fabricated response. Hand-read; a FLOOR, not a total.
      defensible         Shaped like a no-op and deliberately so, because the
                         filter pipeline is the work. Reported, NOT counted as a
                         defect. Every entry carries a written reason.

    The unit is ROUTES. Method counts are reported alongside because the
    historical number (316) was in methods and needs to stay legible.

.DESCRIPTION_RATCHET
    Every metric is enforced in BOTH directions, as before: exceeding the
    baseline fails, and beating it also fails until the baseline is lowered in
    the same commit. That stops the count creeping back after a cleanup and
    stops a stale baseline hiding a regression.

    !! `-WriteBaseline` REFUSES to raise any metric unless
    `-AcceptWidenedDefinition "<reason>"` is also given, and the reason plus the
    previous values are recorded in the baseline file. Raising a count is
    sometimes correct - the 2026-08-21 rewrite raised it deliberately, because
    the previous number was too small - but it must never be the quiet way to
    make a failing tool pass.

    Remediation guidance: docs/PRODUCTION_READINESS_REMEDIATION.md (R-1).
    Triage each finding into: implement for real (a client calls it), delete the
    route (nothing calls it), or declare it deliberately in DEFENSIBLE below
    with a reason.

.PARAMETER RepositoryRoot
    Root of the aspnet-backend tree. Defaults to the parent of this script.

.PARAMETER WriteBaseline
    Rewrite the baseline file from the current scan.

.PARAMETER AcceptWidenedDefinition
    Required by -WriteBaseline when any metric would increase. Free text; it is
    stored in the baseline as an audit record.

.PARAMETER Detail
    List every finding, grouped by file, one line per ROUTE.

.PARAMETER Json
    Write the findings to this path as JSON. This is the machine-readable
    contract consumed by build-stub-route-inventory.mjs, which previously
    scraped -Detail text and silently mis-parsed it once already.
#>
[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [switch]$WriteBaseline,
    [string]$AcceptWidenedDefinition,
    [switch]$Detail,
    [string]$Json
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}

$controllersPath = Join-Path $RepositoryRoot 'src/Nexus.Api/Controllers'
$baselinePath = Join-Path $RepositoryRoot 'scripts/noop-stubs-baseline.json'

if (-not (Test-Path $controllersPath)) {
    Write-Host "!! Controllers directory not found: $controllersPath" -ForegroundColor Red
    exit 2
}

# ---------------------------------------------------------------------------
# Category 1 - plain no-op method.
#
# A method body counts as doing REAL work if it touches data or delegates.
# Deliberately broad: the goal is to flag only the unambiguous cases.
#
# !! The work tokens are ANCHORED on their left edge (2026-08-21). They were
# not, and unanchored `_repo` matched the response literal
# `auto_hide_report_threshold`, while `_token` matched `csrf_token`. Three
# genuinely do-nothing methods were therefore excused by their own response
# field names: AuthParityController.CsrfToken, MiscParityController.RootCsrfToken
# and ReactFrontendCompatibilityController.AdminModerationSettings (which
# returns three hardcoded moderation settings and reads no tenant config).
# ---------------------------------------------------------------------------
$workPattern = '(?<![A-Za-z0-9_])(_db\b|_repo|_mediator|_fileUpload|_token|_cache|_mail|_publisher)|await\b|Service\.|DbContext|SaveChanges|HttpContext\.'
# A response counts as success-shaped if it claims success to the caller.
$successPattern = 'Ok\(\s*new\s*\{|Ok\(\s*new\s+[A-Za-z]|Created\(|StatusCode\(\s*20|NoContent\('
$actionPattern = '\[Http(Get|Post|Put|Delete|Patch)\b'
$signaturePattern = 'public\s+(async\s+)?[A-Za-z0-9_<>\[\],\?\s\.]+\s+\w+\s*\('

# ---------------------------------------------------------------------------
# Category 3 - hardcoded payload. NO STATIC RULE EXISTS for this shape: the
# method does real authorisation and database work, then fabricates the answer,
# so every heuristic signal a scanner could use is present. Each entry below was
# read by hand on 2026-08-21 (docs/generated/admin-corpus/README.md). It is a
# FLOOR, never a total. A heuristic sweep produced 8 candidates of which 2 were
# opened and REJECTED as real work (AdminCompatibility3Controller.ListAdminComments
# and .GetSuperAuditLog both take an empty early return only under a query filter),
# which is why this is a list and not a rule.
# ---------------------------------------------------------------------------
$hardcodedPayload = @(
    @{ file = 'AdminPerformanceSummaryController.cs'; method = 'Summary';
       reason = 'auth is real; slowest_requests / slowest_queries / memory_spikes are Array.Empty and request_volume an empty dictionary, always. The performance dashboard can never show data.' }
    @{ file = 'AdminPrerenderCompatibilityController.cs'; method = 'Coverage';
       reason = 'reads tenants, then reports rendered=0 and every expected route missing, always.' }
    @{ file = 'AdminPrerenderCompatibilityController.cs'; method = 'TenantSafety';
       reason = 'snapshots=0, stale=0, missing=all, always.' }
    @{ file = 'AdminPrerenderCompatibilityController.cs'; method = 'Purge';
       reason = 'validates, writes an audit row, returns deleted_count=0. Nothing is purged.' }
    @{ file = 'AdminPrerenderCompatibilityController.cs'; method = 'PurgeUnexpected';
       reason = 'deleted_total=0, unconditionally.' }
    @{ file = 'AdminCompatibility2Controller.cs'; method = 'SelectAbWinner';
       reason = 'unconditional 409 "No persisted A/B test variants exist", supported=false.' }
)

# ---------------------------------------------------------------------------
# Category 4 - DEFENSIBLE. Shaped like a no-op on purpose. Reported separately
# and NOT counted as a defect.
#
# !! This list is deliberately SHORT, and the short version is the point. The
# temptation with an exclusion list is to sweep in everything that looks
# awkward, which converts an honest count into a flattering one. The only shape
# admitted here is: the ASP.NET filter pipeline performs the entire contract
# before the body runs, and the body only projects the authenticated principal.
# A wrong token never reaches these bodies - [Authorize] answers 401 first - so
# there is nothing for the body to do.
#
# !! What was CONSIDERED and REFUSED, so nobody has to re-derive it:
#   AuthParityController.Heartbeat        Laravel's counterpart validates the
#       bearer token and returns expires_at / time_remaining / needs_refresh
#       (app/Http/Controllers/Api/AuthController.php:908). ASP.NET returns
#       {alive, at}. That is a contract difference, not a filter doing the work.
#   AuthParityController.OAuthIdentities  identities = Array.Empty<object>()
#       always, whatever the member has linked.
#   AuthParityController.UnlinkOAuth      returns {success = true} and unlinks
#       nothing.
#   AuthParityController.LinkOAuth / .EnabledProviders / .OAuthRedirect
#       fabricate state strings and provider lists without persisting or
#       consulting anything linkable.
# Those five stay counted as defects.
#
# !! TWO OPEN QUESTIONS left deliberately UNRESOLVED, recorded so the next owner
#    of this list does not have to re-derive them. Both would LOWER the count,
#    and this pass deliberately made no downward adjustments - every one weakens
#    the evidence for the upward move it exists to justify.
#   HealthController.Live  ([HttpGet] + [HttpGet("live")], returns
#       {status="healthy", timestamp}). A liveness probe's whole contract IS
#       answering 200; the readiness endpoint beside it does the upstream checks.
#       This is arguably the clearest defensible case in the tree. It is counted
#       as a defect today because it was in the 316 baseline and excusing it here
#       would be a narrowing this pass has no mandate for.
#   AdminAiProvidersController.List  reads `_factory.Resolve()` and
#       `_factory.All`, which IS delegation - the scanner misses it only because
#       `_factory` is not in $workPattern. A likely FALSE POSITIVE, pre-existing
#       in the 316 baseline. Adding `_factory` to $workPattern would fix it and
#       lower the count by 1 route / 1 method; do that as its own change, with
#       its own check that nothing else moves.
# ---------------------------------------------------------------------------
$defensible = @(
    @{ file = 'AuthParityController.cs'; method = 'CheckSession';
       reason = '[Authorize] IS the contract: the endpoint answers "am I authenticated", and the body only projects User.GetUserId() / GetRole() from the validated principal. An invalid token gets 401 from the filter and never reaches the body.' }
    @{ file = 'AuthParityController.cs'; method = 'RefreshSession';
       reason = '[Authorize] validated the bearer token before the body ran; the sliding-session contract this endpoint serves is satisfied by that validation, and the body projects the principal.' }
    @{ file = 'AuthParityController.cs'; method = 'ValidateTokenGet';
       reason = '[Authorize] IS the validation. Documented in the source at AuthParityController.cs:212 - the previous anonymous version returned {valid:true} without checking anything and was retired 2026-05-11 for exactly that.' }
    @{ file = 'AuthParityController.cs'; method = 'ValidateTokenPost';
       reason = 'Same as ValidateTokenGet; the POST spelling exists for clients that send the token in a body and is now routed through the same [Authorize] filter.' }
)

$hardcodedKeys = @{}
foreach ($h in $hardcodedPayload) { $hardcodedKeys[($h.file + '::' + $h.method)] = $h.reason }
$defensibleKeys = @{}
foreach ($d in $defensible) { $defensibleKeys[($d.file + '::' + $d.method)] = $d.reason }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Contiguous attribute block immediately above a signature line (0-based index).
function Get-AttributeBlock {
    param([string[]]$Lines, [int]$SignatureIndex)
    $block = New-Object System.Collections.Generic.List[string]
    for ($j = $SignatureIndex - 1; $j -ge 0; $j--) {
        $l = $Lines[$j].Trim()
        if ($l -eq '' -or $l.StartsWith('//') -or $l.StartsWith('/*') -or $l.StartsWith('*')) { continue }
        if ($l.StartsWith('[')) { $block.Add($l); continue }
        break
    }
    return $block
}

# Every [Http<Verb>("template")] in an attribute block, in source order.
function Get-RouteAttributes {
    param([System.Collections.Generic.List[string]]$Block)
    $routes = New-Object System.Collections.Generic.List[object]
    # Reverse: Get-AttributeBlock walks upward, so the list is bottom-to-top.
    for ($i = $Block.Count - 1; $i -ge 0; $i--) {
        foreach ($m in [regex]::Matches($Block[$i], '\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"\s*\))?\s*\]')) {
            $routes.Add([pscustomobject]@{
                verb     = $m.Groups[1].Value.ToUpperInvariant()
                template = $m.Groups[2].Value
                attribute = $m.Value
            })
        }
    }
    return $routes
}

# Method body from a signature line: expression-bodied one-liner, or braces.
function Get-MethodBody {
    param([string[]]$Lines, [int]$SignatureIndex)
    $j = $SignatureIndex
    if ($Lines[$j] -match '=>' -and $Lines[$j] -match ';') {
        return [pscustomobject]@{ body = $Lines[$j]; endIndex = $j }
    }
    $depth = 0
    $started = $false
    $sb = New-Object System.Text.StringBuilder
    $k = $j
    while ($k -lt $Lines.Length) {
        $depth += ([regex]::Matches($Lines[$k], '\{')).Count
        $depth -= ([regex]::Matches($Lines[$k], '\}')).Count
        [void]$sb.AppendLine($Lines[$k])
        if ($Lines[$k] -match '\{') { $started = $true }
        if ($started -and $depth -le 0) { break }
        $k++
        if (($k - $j) -gt 200) { break }
    }
    return [pscustomobject]@{ body = $sb.ToString(); endIndex = $k }
}

# Controller-level [Route("...")] prefix and the class name, so absolute paths
# can be reported and the [controller] token can be resolved.
function Get-ControllerInfo {
    param([string[]]$Lines)
    for ($i = 0; $i -lt $Lines.Length; $i++) {
        if ($Lines[$i] -match '^\s*public\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)') {
            $name = $Matches[1]
            $prefix = ''
            for ($j = $i - 1; $j -ge 0 -and $j -gt ($i - 15); $j--) {
                if ($Lines[$j] -match '^\s*\[Route\(\s*"([^"]*)"\s*\)\]') { $prefix = $Matches[1]; break }
            }
            return [pscustomobject]@{ name = $name; prefix = $prefix }
        }
    }
    return [pscustomobject]@{ name = ''; prefix = '' }
}

function Join-RoutePath {
    param([string]$Prefix, [string]$Template, [string]$ControllerName = '', [string]$ActionName = '')
    $t = [string]$Template
    $p = [string]$Prefix
    # `~/x` and `/x` are ABSOLUTE in ASP.NET: they ignore the controller prefix.
    # The old inventory joined them onto the prefix instead, producing paths like
    # `/api/auth/~/api/v2/auth/oauth/...` that match nothing a client ever calls,
    # so five OAuth endpoints were unfindable by the condition-5 check.
    if ($t.StartsWith('~/')) { $out = '/' + $t.Substring(2).TrimStart('/') }
    elseif ($t.StartsWith('/')) { $out = '/' + $t.TrimStart('/') }
    else {
        $parts = @()
        if (-not [string]::IsNullOrWhiteSpace($p)) { $parts += $p.Trim('/') }
        if (-not [string]::IsNullOrWhiteSpace($t)) { $parts += $t.Trim('/') }
        if ($parts.Count -eq 0) { $out = '/' } else { $out = '/' + ($parts -join '/') }
    }
    # Resolve the token forms. `[Route("[controller]")]` is real in this tree
    # (HealthController), and an unresolved `/[controller]/live` matches no
    # request path, so condition-5 checks against it always answer "clean".
    if ($ControllerName) {
        $short = $ControllerName -replace 'Controller$', ''
        $out = $out.Replace('[controller]', $short)
    }
    if ($ActionName) { $out = $out.Replace('[action]', $ActionName) }
    return $out
}

# ---------------------------------------------------------------------------
# Scan 1 + 3 + 4: per-method categories over every controller.
# ---------------------------------------------------------------------------
$findings = New-Object System.Collections.Generic.List[object]
$defensibleFindings = New-Object System.Collections.Generic.List[object]
$seenMethods = New-Object 'System.Collections.Generic.HashSet[string]'

foreach ($file in Get-ChildItem -Path $controllersPath -Filter '*.cs' -File | Sort-Object Name) {
    $lines = [System.IO.File]::ReadAllLines($file.FullName)
    $ctrl = Get-ControllerInfo -Lines $lines

    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -notmatch $signaturePattern) { continue }

        $block = Get-AttributeBlock -Lines $lines -SignatureIndex $i
        if ($block.Count -eq 0) { continue }
        $hasAction = $false
        foreach ($b in $block) { if ($b -match $actionPattern) { $hasAction = $true; break } }
        if (-not $hasAction) { continue }

        $methodName = if ($lines[$i] -match '\s(\w+)\s*\(') { $Matches[1] } else { '?' }
        $key = $file.Name + '::' + $methodName + '::' + ($i + 1)
        if (-not $seenMethods.Add($key)) { continue }

        $bodyInfo = Get-MethodBody -Lines $lines -SignatureIndex $i
        $body = $bodyInfo.body

        $methodKey = $file.Name + '::' + $methodName
        $category = $null
        $reason = $null

        if ($body -match $successPattern -and $body -notmatch $workPattern) {
            if ($defensibleKeys.ContainsKey($methodKey)) {
                $category = 'defensible'
                $reason = $defensibleKeys[$methodKey]
            }
            else {
                $category = 'noop_method'
                $reason = 'body performs no data access and no delegation, and answers success-shaped'
            }
        }
        elseif ($hardcodedKeys.ContainsKey($methodKey)) {
            $category = 'hardcoded_payload'
            $reason = $hardcodedKeys[$methodKey]
        }
        elseif ($defensibleKeys.ContainsKey($methodKey)) {
            # A declared-defensible method that no longer looks like a no-op has
            # presumably been implemented. Do not silently keep excusing it.
            Write-Host ("  note: {0}::{1} is on the DEFENSIBLE list but no longer matches the no-op shape - remove it from the list." -f $file.Name, $methodName) -ForegroundColor DarkYellow
        }

        if ($null -eq $category) { continue }

        foreach ($r in (Get-RouteAttributes -Block $block)) {
            $entry = [pscustomobject]@{
                file      = $file.Name
                line      = $i + 1
                method    = $methodName
                category  = $category
                verb      = $r.verb
                template  = $r.template
                attribute = $r.attribute
                path      = (Join-RoutePath -Prefix $ctrl.prefix -Template $r.template -ControllerName $ctrl.name -ActionName $methodName)
                reason    = $reason
            }
            if ($category -eq 'defensible') { $defensibleFindings.Add($entry) } else { $findings.Add($entry) }
        }
    }
}

# ---------------------------------------------------------------------------
# Scan 2: echo-store dispatcher fall-through.
#
# !! This is a FAITHFUL PORT of dispatcherFallThrough() in
# scripts/build-admin-corpus.mjs, which is where the 177 figure was first
# established and where the definition is documented. It is a port rather than a
# shared call because the gate must not depend on node (the .mjs depends on this
# script, so a shared module would be circular). The two implementations are an
# independent replicate and MUST agree; they were verified identical - 321
# routes, 144 explicit branches, 177 fall-through, same route set - on
# 2026-08-21. If they ever disagree, ONE of them is wrong and the disagreement
# is the finding.
#
# The pattern: `AdminExplicitParityController` declares its whole admin surface
# on five parameterless catch-all actions that `switch` on `Request.Path`. A
# route with no matching arm reaches `_ => PersistCompatibilityWrite(...)` or
# `_ => GetPersistedCompatibilityRead(path)`. Those record the request body in
# CompatibilityAuditEntries and answer 202 `side_effect = "recorded_only"`, or
# replay what was recorded. Real database traffic, zero product effect.
# ---------------------------------------------------------------------------
$echoFindings = New-Object System.Collections.Generic.List[object]
$dispatcherSummary = New-Object System.Collections.Generic.List[object]
$echoControllerName = 'AdminExplicitParityController.cs'
$echoControllerPath = Join-Path $controllersPath $echoControllerName

if (-not (Test-Path $echoControllerPath)) {
    Write-Host "!! Echo-store dispatcher controller not found: $echoControllerPath. Refusing to report zero fall-through routes on a missing file." -ForegroundColor Red
    exit 2
}

$echoLines = [System.IO.File]::ReadAllLines($echoControllerPath)
$echoSinkPattern = 'PersistCompatibilityWrite|GetPersistedCompatibilityRead'
$dispatcherSigs = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $echoLines.Length; $i++) {
    if ($echoLines[$i] -match 'public\s+(async\s+)?Task<IActionResult>\s+(Delete|Get|Patch|Post|Put)\(\s*\)') {
        $dispatcherSigs.Add([pscustomobject]@{ name = $Matches[2]; index = $i })
    }
}

if ($dispatcherSigs.Count -eq 0) {
    Write-Host "!! Found no catch-all dispatchers in $echoControllerName. Either they were removed (delete this scan and lower the baseline) or the detector broke. Refusing to report zero." -ForegroundColor Red
    exit 2
}

foreach ($d in $dispatcherSigs) {
    $block = Get-AttributeBlock -Lines $echoLines -SignatureIndex $d.index
    $routes = Get-RouteAttributes -Block $block
    $bodyInfo = Get-MethodBody -Lines $echoLines -SignatureIndex $d.index
    $body = $bodyInfo.body

    if ($body -notmatch $echoSinkPattern) {
        # This dispatcher's default arm is no longer the echo store. That is a
        # real change, not something to pass over quietly.
        Write-Host ("  note: dispatcher {0}() no longer routes its default arm to the echo store - re-read it before trusting this scan." -f $d.name) -ForegroundColor DarkYellow
        $dispatcherSummary.Add([pscustomobject]@{ dispatcher = $d.name; routes = $routes.Count; explicit_branch = $routes.Count; fell_through = 0 })
        continue
    }

    $literals = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($m in [regex]::Matches($body, '(?m)^\s*"(/api/[^"]+)"\s*=>')) {
        [void]$literals.Add($m.Groups[1].Value.ToLowerInvariant())
    }
    $guardPrefixes = New-Object System.Collections.Generic.List[string]
    foreach ($m in [regex]::Matches($body, '"(/api/[^"]+)"')) {
        $v = $m.Groups[1].Value.ToLowerInvariant()
        if ($v.EndsWith('/')) { $guardPrefixes.Add($v) }
    }
    $guardSuffixed = New-Object System.Collections.Generic.List[object]
    foreach ($m in [regex]::Matches($body, 'TryGet\w+\(\s*path,\s*"([^"]+)",\s*"([^"]+)"')) {
        $guardSuffixed.Add([pscustomobject]@{ pre = $m.Groups[1].Value.ToLowerInvariant(); suf = $m.Groups[2].Value.ToLowerInvariant() })
    }
    $reportExport = $body -match 'IsAdminReportExportPath'

    $covered = 0
    foreach ($r in $routes) {
        $p = $r.template.ToLowerInvariant()
        $ok = $literals.Contains($p)
        if (-not $ok) {
            foreach ($g in $guardSuffixed) { if ($p.StartsWith($g.pre) -and $p.EndsWith($g.suf)) { $ok = $true; break } }
        }
        if (-not $ok) {
            foreach ($g in $guardPrefixes) { if ($p.StartsWith($g) -and $p -match '\{[^}]*\}$') { $ok = $true; break } }
        }
        if (-not $ok -and $reportExport -and $p -match '/api/v2/admin/reports/') { $ok = $true }

        if ($ok) { $covered++ }
        else {
            $echoFindings.Add([pscustomobject]@{
                file      = $echoControllerName
                line      = $d.index + 1
                method    = $d.name
                category  = 'echo_store'
                verb      = $r.verb
                template  = $r.template
                attribute = $r.attribute
                path      = (Join-RoutePath -Prefix '' -Template $r.template -ControllerName 'AdminExplicitParityController')
                reason    = ('declared on the ' + $d.name + '() catch-all with no matching switch branch, so it falls through to the echo store (records the body in CompatibilityAuditEntries, answers side_effect="recorded_only")')
            })
        }
    }
    $dispatcherSummary.Add([pscustomobject]@{ dispatcher = $d.name; routes = $routes.Count; explicit_branch = $covered; fell_through = ($routes.Count - $covered) })
}

foreach ($e in $echoFindings) { $findings.Add($e) }

# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
# A route can be reached by more than one category (a no-op method that is also
# a dispatcher fall-through). Dedupe by VERB+PATH so the headline is a count of
# distinct broken endpoints, and record the overlap so the arithmetic checks.
$distinct = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($f in $findings) { [void]$distinct.Add($f.verb + ' ' + $f.path) }
$overlapRoutes = $findings.Count - $distinct.Count

$byCategory = [ordered]@{}
foreach ($cat in @('noop_method', 'echo_store', 'hardcoded_payload')) {
    $rows = @($findings | Where-Object { $_.category -eq $cat })
    $methods = @($rows | ForEach-Object { $_.file + '::' + $_.method } | Sort-Object -Unique)
    $byCategory[$cat] = [ordered]@{ routes = $rows.Count; methods = $methods.Count }
}
$defensibleMethods = @($defensibleFindings | ForEach-Object { $_.file + '::' + $_.method } | Sort-Object -Unique)
$defensibleMetrics = [ordered]@{ routes = $defensibleFindings.Count; methods = $defensibleMethods.Count }

$totalRoutes = $distinct.Count
$totalMethods = @($findings | ForEach-Object { $_.file + '::' + $_.method } | Sort-Object -Unique).Count
$byFile = $findings | Group-Object file | Sort-Object Count -Descending

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
Write-Host "Do-nothing endpoints (unit: ROUTES): $totalRoutes distinct, across $totalMethods method(s)" -ForegroundColor Cyan
foreach ($cat in $byCategory.Keys) {
    Write-Host ("  {0,5}  {1,-18} ({2} method(s))" -f $byCategory[$cat].routes, $cat, $byCategory[$cat].methods)
}
Write-Host ("  {0,5}  {1,-18} ({2} method(s)) - NOT counted as defects" -f $defensibleMetrics.routes, 'defensible', $defensibleMetrics.methods) -ForegroundColor DarkGray
if ($overlapRoutes -gt 0) {
    Write-Host ("  {0,5}  route(s) matched by more than one category (deduped out of the total)" -f $overlapRoutes) -ForegroundColor DarkGray
}
Write-Host ''
Write-Host 'Echo-store dispatchers (AdminExplicitParityController):' -ForegroundColor Cyan
foreach ($s in $dispatcherSummary) {
    Write-Host ("  {0,-7} routes {1,4}   explicit branch {2,4}   falls through {3,4}" -f $s.dispatcher, $s.routes, $s.explicit_branch, $s.fell_through)
}
Write-Host ''
Write-Host 'Top files:' -ForegroundColor Cyan
foreach ($group in ($byFile | Select-Object -First 12)) {
    Write-Host ("  {0,4}  {1}" -f $group.Count, $group.Name)
}

if ($Detail) {
    Write-Host ''
    foreach ($group in $byFile) {
        Write-Host "--- $($group.Name)" -ForegroundColor Yellow
        foreach ($item in ($group.Group | Sort-Object line, verb, template)) {
            Write-Host ("  {0}:{1}  {2}  {3}  [{4}]  {5} {6}" -f `
                $item.file, $item.line, $item.method, $item.attribute, $item.category, $item.verb, $item.path)
        }
    }
    Write-Host ''
    Write-Host '--- DEFENSIBLE (declared deliberately, not defects)' -ForegroundColor Green
    foreach ($item in $defensibleFindings) {
        Write-Host ("    {0}:{1}  {2}  {3} {4}" -f $item.file, $item.line, $item.method, $item.verb, $item.path)
        Write-Host ("        reason: {0}" -f $item.reason) -ForegroundColor DarkGray
    }
}

if ($Json) {
    $payload = [ordered]@{
        _comment      = 'Generated by check-noop-stubs.ps1. Machine-readable findings; the -Detail text is for humans and must not be scraped.'
        generated_at  = (Get-Date -Format 'yyyy-MM-dd')
        unit          = 'routes'
        total_routes  = $totalRoutes
        total_methods = $totalMethods
        overlap_routes = $overlapRoutes
        categories    = $byCategory
        defensible    = $defensibleMetrics
        dispatchers   = $dispatcherSummary
        findings      = $findings
        defensible_findings = $defensibleFindings
    }
    $dir = Split-Path -Parent $Json
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $payload | ConvertTo-Json -Depth 8 | Set-Content -Path $Json -Encoding utf8
    Write-Host ''
    Write-Host "Findings JSON written: $Json" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Ratchet
# ---------------------------------------------------------------------------
$metrics = [ordered]@{
    'total (routes)'            = $totalRoutes
    'total (methods)'           = $totalMethods
    'noop_method (routes)'      = $byCategory['noop_method'].routes
    'noop_method (methods)'     = $byCategory['noop_method'].methods
    'echo_store (routes)'       = $byCategory['echo_store'].routes
    'echo_store (methods)'      = $byCategory['echo_store'].methods
    'hardcoded_payload (routes)'  = $byCategory['hardcoded_payload'].routes
    'hardcoded_payload (methods)' = $byCategory['hardcoded_payload'].methods
    'defensible (routes)'       = $defensibleMetrics.routes
    'defensible (methods)'      = $defensibleMetrics.methods
}

function Get-BaselineMetrics {
    param($Baseline)
    return [ordered]@{
        'total (routes)'            = [int]$Baseline.total
        'total (methods)'           = [int]$Baseline.total_methods
        'noop_method (routes)'      = [int]$Baseline.categories.noop_method.routes
        'noop_method (methods)'     = [int]$Baseline.categories.noop_method.methods
        'echo_store (routes)'       = [int]$Baseline.categories.echo_store.routes
        'echo_store (methods)'      = [int]$Baseline.categories.echo_store.methods
        'hardcoded_payload (routes)'  = [int]$Baseline.categories.hardcoded_payload.routes
        'hardcoded_payload (methods)' = [int]$Baseline.categories.hardcoded_payload.methods
        'defensible (routes)'       = [int]$Baseline.defensible.routes
        'defensible (methods)'      = [int]$Baseline.defensible.methods
    }
}

if ($WriteBaseline) {
    $previous = $null
    if (Test-Path $baselinePath) {
        $previous = Get-Content $baselinePath -Raw | ConvertFrom-Json
    }

    $increases = New-Object System.Collections.Generic.List[string]
    if ($null -ne $previous -and $null -ne $previous.categories) {
        $prev = Get-BaselineMetrics -Baseline $previous
        foreach ($name in $metrics.Keys) {
            if ($metrics[$name] -gt $prev[$name]) {
                $increases.Add(("{0}: {1} -> {2}" -f $name, $prev[$name], $metrics[$name]))
            }
        }
    }
    elseif ($null -ne $previous) {
        # Pre-2026-08-21 baseline shape: one method count in `total`. Any write
        # from the new model is a definition change by construction.
        $increases.Add(("counting model replaced: old baseline recorded total={0} METHODS in one category; the new model counts ROUTES in four" -f $previous.total))
    }

    if ($increases.Count -gt 0 -and [string]::IsNullOrWhiteSpace($AcceptWidenedDefinition)) {
        Write-Host ''
        $refuseMessage = @"
REFUSING TO RAISE THE BASELINE.

$($increases -join "`n")

Raising a count is sometimes right - widening the definition SHOULD raise it -
but it must never be the quiet way to make a failing tool pass. Say so
explicitly and the reason is recorded in the baseline:

    pwsh ./aspnet-backend/scripts/check-noop-stubs.ps1 -WriteBaseline ``
         -AcceptWidenedDefinition "why this count is legitimately higher"

If you did NOT intend to add do-nothing endpoints, fix the code instead.
"@
        Write-Host $refuseMessage -ForegroundColor Red
        exit 2
    }

    $payload = [ordered]@{
        '_comment'     = 'Shrink-only, PER METRIC, enforced in both directions. See docs/PRODUCTION_READINESS_REMEDIATION.md (R-1). Lower a number in the SAME commit that fixes endpoints; never raise one without -AcceptWidenedDefinition.'
        '_unit'        = 'routes. `total` is DISTINCT verb+path across all defect categories. Method counts are kept because the historical figure (316) was in methods.'
        generated_at   = (Get-Date -Format 'yyyy-MM-dd')
        total          = $totalRoutes
        total_methods  = $totalMethods
        overlap_routes = $overlapRoutes
        categories     = $byCategory
        defensible     = $defensibleMetrics
        dispatchers    = $dispatcherSummary
        by_file        = ($byFile | ForEach-Object { [ordered]@{ file = $_.Name; count = $_.Count } })
    }
    if ($increases.Count -gt 0) {
        $payload['_raised'] = [ordered]@{
            on      = (Get-Date -Format 'yyyy-MM-dd')
            reason  = $AcceptWidenedDefinition
            changes = @($increases)
        }
    }
    $payload | ConvertTo-Json -Depth 8 | Set-Content -Path $baselinePath -Encoding utf8
    Write-Host "Baseline written: $baselinePath (total $totalRoutes routes / $totalMethods methods)" -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $baselinePath)) {
    Write-Host "!! Baseline missing: $baselinePath. Run with -WriteBaseline to create it." -ForegroundColor Red
    exit 2
}

$baseline = Get-Content $baselinePath -Raw | ConvertFrom-Json

if ($null -eq $baseline.categories -or $null -eq $baseline.defensible -or $null -eq $baseline.total_methods) {
    $shapeMessage = @"
BASELINE IS IN THE PRE-2026-08-21 SHAPE (a single method count).

That shape recorded only the plain no-op category and counted methods rather
than routes, which is the undercount this script was rewritten to fix. Refusing
to compare against it - a partial baseline would report a widened count as a
regression and invite someone to "fix" it by narrowing the scanner again.

Regenerate deliberately:
    pwsh ./aspnet-backend/scripts/check-noop-stubs.ps1 -WriteBaseline ``
         -AcceptWidenedDefinition "reason"
"@
    Write-Host $shapeMessage -ForegroundColor Red
    exit 2
}

$baselineMetrics = Get-BaselineMetrics -Baseline $baseline

# Arithmetic self-check: the categories must account for the total. A silent
# accounting bug here would be indistinguishable from a real improvement.
$categorySum = $byCategory['noop_method'].routes + $byCategory['echo_store'].routes + $byCategory['hardcoded_payload'].routes
if (($categorySum - $overlapRoutes) -ne $totalRoutes) {
    Write-Host "!! INTERNAL ACCOUNTING ERROR: categories sum to $categorySum with $overlapRoutes overlap(s), which does not reconcile with total $totalRoutes. Fix the script; do not touch the baseline." -ForegroundColor Red
    exit 2
}

$up = New-Object System.Collections.Generic.List[string]
$down = New-Object System.Collections.Generic.List[string]
foreach ($name in $metrics.Keys) {
    $now = $metrics[$name]
    $was = $baselineMetrics[$name]
    if ($now -gt $was) { $up.Add(("  {0,-28} {1,5}  (baseline {2})" -f $name, $now, $was)) }
    elseif ($now -lt $was) { $down.Add(("  {0,-28} {1,5}  (baseline {2})" -f $name, $now, $was)) }
}

if ($up.Count -gt 0) {
    # If some metrics rose and others fell in the same run, show BOTH. A run that
    # excuses a defect into the DEFENSIBLE list looks exactly like this - one
    # count up, another down - and reporting only half of it would let the
    # laundering read as a repair.
    $alsoDown = if ($down.Count -gt 0) { "`nAND THESE FELL IN THE SAME RUN (so something was reclassified, not only added):`n" + ($down -join "`n") } else { '' }
    Write-Host ''
    Write-Error @"
DO-NOTHING ENDPOINT COUNT INCREASED.

$($up -join "`n")
$alsoDown

An endpoint now returns a success-shaped payload while performing none of its
work. That is the defect class this ratchet exists to stop: it answers 200, so
every route inventory and the route-alias tests report it as working, while the
feature does nothing at all.

Run with -Detail to list them. Either implement the endpoint, or delete the
route so callers get an honest 404 instead of a convincing lie. If the endpoint
is deliberately shaped this way because the filter pipeline does the work, add
it to the DEFENSIBLE list in this script WITH A WRITTEN REASON - that moves it
out of the defect totals and into its own ratcheted count.
"@
    exit 1
}

if ($down.Count -gt 0) {
    Write-Host ''
    Write-Error @"
DO-NOTHING ENDPOINT COUNT IMPROVED.

$($down -join "`n")

Lower the baseline in this same commit so the gain is locked in:
    pwsh ./aspnet-backend/scripts/check-noop-stubs.ps1 -WriteBaseline
"@
    exit 1
}

Write-Host ''
Write-Host ("Matches baseline on all {0} metrics ({1} routes / {2} methods). No new do-nothing endpoints." -f $metrics.Count, $totalRoutes, $totalMethods) -ForegroundColor Green
exit 0
