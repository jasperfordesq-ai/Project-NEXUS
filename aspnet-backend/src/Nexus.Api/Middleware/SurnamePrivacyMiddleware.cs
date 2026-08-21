// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Nodes;
using Nexus.Api.Extensions;

namespace Nexus.Api.Middleware;

/// <summary>
/// Strips member surnames from JSON API responses so non-admin viewers only
/// ever see first names. Admins (admin / super_admin) pass through unchanged.
/// A member always sees their own surname (object's id matches current user).
///
/// Scrubs the following property names: last_name, lastName, LastName,
/// surname, Surname. When an object containing a first name also exposes a
/// pre-composed "name" / "full_name" / "display_name" field, that composite
/// is rewritten to the first name only to prevent surname leakage through
/// server-side concatenation (e.g. leaderboards).
/// </summary>
public sealed class SurnamePrivacyMiddleware
{
    private static readonly string[] SurnameKeys =
    {
        "last_name", "lastName", "LastName", "Lastname", "lastname",
        "surname", "Surname",
        "family_name", "familyName", "FamilyName",
        "lname", "LName"
    };

    // Composite name fields: rewritten to first-name-only on user-shaped
    // objects. The string-only gate in ScrubObject means we never mangle
    // integer-valued keys (e.g. created_by: 42).
    private static readonly string[] CompositeNameKeys =
    {
        "name", "Name",
        "full_name", "fullName", "FullName",
        "display_name", "displayName", "DisplayName",
        "OwnerDisplayName", "owner_display_name",
        "author_name", "authorName", "AuthorName",
        "creator_name", "creatorName", "CreatorName",
        "owner_name", "ownerName", "OwnerName",
        "host_name", "hostName", "HostName",
        "organizer_name", "organizerName", "OrganizerName",
        "recipient_name", "recipientName", "RecipientName",
        "sender_name", "senderName", "SenderName",
        "from_name", "fromName", "FromName",
        "to_name", "toName", "ToName",
        "reviewer_name", "reviewerName", "ReviewerName",
        "member_name", "memberName", "MemberName",
        "user_name", "UserName", // userName intentionally omitted — that's the handle, no spaces
        "posted_by_name", "postedByName", "PostedByName",
        "posted_by", "postedBy", "PostedBy",
        "created_by_name", "createdByName", "CreatedByName",
        "created_by", "createdBy", "CreatedBy",
        "updated_by_name", "updatedByName", "UpdatedByName",
        "verifier_name", "verifierName", "VerifierName",
        "rejector_name", "rejectorName", "RejectorName",
        "nominee_name", "nomineeName",
        "participant_name", "participantName",
        "commenter_name", "commenterName",
        "endorser_name", "endorserName",
        "inviter_name", "inviterName",
        "invitee_name", "inviteeName",
        "granted_by_name", "grantedByName",
        "approved_by_name", "approvedByName",
        "assigned_to_name", "assignedToName",
        "counterparty", "Counterparty", "counterparty_name"
    };

    // 🔴 An organisation's name is NOT a person's name, and must never be cut
    // down to its first word. "Bristol Community Trust" is not "Bristol".
    //
    // Laravel expresses this exemption in exactly one way, at every projection
    // where it hides a surname: it unsets the surname UNCONDITIONALLY, and then
    // rewrites the composite `name` to the first name ONLY when the profile is
    // not an organisation.
    //
    //   app/Services/UserService.php:147-155
    //       unset($profile['last_name']);
    //       if (($user->profile_type ?? 'individual') !== 'organisation') {
    //           $profile['name'] = $user->first_name ?? '';
    //       }
    //   app/Http/Controllers/Api/UsersController.php:1583-1592 and :1740-1749
    //       the same two lines, applied to each member-directory row.
    //   app/Http/Controllers/Api/UsersController.php:188-202
    //       member search — unsets the surname only, never touches `name`.
    //   app/Support/Events/PublicEventProjection.php:112-126
    //       organiserDisplayName() returns organization_name when
    //       profile_type === 'organisation', else the first name.
    //
    // Two consequences this middleware must reproduce:
    //   1. the exemption covers the COMPOSITE NAME REWRITE ONLY. Laravel still
    //      unsets last_name on an organisation profile, so we still blank it.
    //   2. an ABSENT profile_type is treated as a PERSON. That is Laravel's own
    //      default (`?? 'individual'`), and it is the privacy-preserving choice:
    //      guessing "organisation" would publish a real member's surname through
    //      a composed `name`, whereas guessing "individual" costs at worst a
    //      cosmetically shortened organisation name.
    private static readonly string[] ProfileTypeKeys =
    {
        "profile_type", "profileType", "ProfileType"
    };

    private const string OrganisationProfileType = "organisation";

    private static readonly string[] FirstNameKeys =
    {
        "first_name", "firstName", "FirstName"
    };

    private static readonly string[] IdKeys =
    {
        "id", "user_id", "userId", "Id", "UserId"
    };

    // Secondary signals that an object represents a user (in addition to
    // first_name/last_name). Many endpoints emit pre-composed `name` strings
    // on objects that only carry an avatar/email/handle alongside the id, so
    // we widen detection to catch those.
    private static readonly string[] UserShapeSignalKeys =
    {
        "avatar_url", "avatarUrl", "AvatarUrl",
        "email", "Email",
        "username", "userName", "UserName",
        "handle", "Handle",
        "user_id", "userId", "UserId"
    };

    // Keys that only ever appear on objects which are NOT a person. These veto
    // the WEAK heuristic below (a composite name sitting next to an avatar), and
    // deliberately do NOT veto an explicit first_name/last_name — a real surname
    // field must always still be scrubbed.
    //
    // 🔴 Why this exists. A group conversation carries both `name` and
    // `avatar_url`, which made it look like a member, so the group list renamed
    // "Garden crew" to "Garden" and "Alpha Bravo Charlie" to "Alpha" — the name
    // was chopped at the first space to hide a surname that was never there. It
    // was invisible for two reasons: the create response has no avatar_url so it
    // looked correct, and a group whose conversation id happens to equal the
    // viewer's user id is treated as "self" and passes through intact.
    private static readonly string[] NonUserShapeSignalKeys =
    {
        "is_group", "isGroup", "IsGroup",
        "member_count", "memberCount", "MemberCount"
    };

    // 🔴 Paths where the surname MUST survive, because Laravel — the contract —
    // does not hide it there, and a client reads it to identify a person before
    // an irreversible action.
    //
    // Laravel does NOT apply surname privacy globally. It applies it at exactly
    // four hand-written projections, all of them member DISCOVERY surfaces:
    //   1. app/Services/UserService.php:147-155        GET /api/v2/users/{id}
    //   2. app/Http/Controllers/Api/UsersController.php:188-202
    //                                                  GET /api/v2/users/search
    //   3. app/Http/Controllers/Api/UsersController.php:1583-1592, 1740-1749
    //                                                  GET /api/v2/users
    //   4. app/Support/Events/PublicEventProjection.php:112-126  (public events)
    // Every other Laravel endpoint ships the full surname. This middleware is a
    // global body rewriter, so it over-applies that rule to every /api response
    // — the asymmetry, not the rule, is what diverges from the contract.
    //
    // The wallet recipient search is the case where over-applying does member-
    // facing harm on the money path. Laravel's
    // WalletService::searchUsers (app/Services/WalletService.php:868-907)
    // deliberately selects and returns first_name, last_name AND a composed
    // name, with no viewer check at all — because a member about to hand over
    // time credits must be able to tell two people with the same first name
    // apart. The React transfer flow composes the recipient label CLIENT-side
    // from first_name + last_name (react-frontend/src/components/wallet/
    // TransferModal.tsx:330, 336, 414, 419 and the confirm step at 518), so a
    // blanked surname renders an unidentifiable counterparty on the
    // confirm-before-you-send card. DonateModal and SupportPrepareModal read the
    // same endpoint, and the mobile client reads the composed `name`.
    //
    // This is an exemption, not a weakening: the control never covered this
    // endpoint in the contract. Member discovery (profile, member search,
    // directory) is still scrubbed, which is where Laravel's rule actually lives.
    private static readonly string[] SurnamePrivacyExemptPaths =
    {
        "/api/v2/wallet/user-search",
        "/api/wallet/user-search"
    };

    private readonly RequestDelegate _next;
    private readonly ILogger<SurnamePrivacyMiddleware> _logger;

    public SurnamePrivacyMiddleware(RequestDelegate next, ILogger<SurnamePrivacyMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Admins see everything.
        if (context.User?.IsAdmin() == true)
        {
            await _next(context);
            return;
        }

        // Only scrub /api/* JSON.
        if (!context.Request.Path.StartsWithSegments("/api"))
        {
            await _next(context);
            return;
        }

        // Endpoints Laravel deliberately exempts (see SurnamePrivacyExemptPaths).
        if (IsExemptPath(context.Request.Path))
        {
            await _next(context);
            return;
        }

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        try
        {
            await _next(context);

            buffer.Position = 0;

            var contentType = context.Response.ContentType ?? string.Empty;
            var isJson = contentType.Contains("application/json", StringComparison.OrdinalIgnoreCase);

            if (!isJson || buffer.Length == 0)
            {
                context.Response.Body = originalBody;
                buffer.Position = 0;
                await buffer.CopyToAsync(originalBody);
                return;
            }

            JsonNode? root;
            try
            {
                root = JsonNode.Parse(buffer);
            }
            catch (JsonException ex)
            {
                _logger.LogDebug(ex, "SurnamePrivacy: response not valid JSON, passing through");
                context.Response.Body = originalBody;
                buffer.Position = 0;
                await buffer.CopyToAsync(originalBody);
                return;
            }

            if (root is null)
            {
                context.Response.Body = originalBody;
                buffer.Position = 0;
                await buffer.CopyToAsync(originalBody);
                return;
            }

            var currentUserId = context.User?.GetUserId();
            Scrub(root, currentUserId);

            var rewritten = JsonSerializer.SerializeToUtf8Bytes(root);
            context.Response.Body = originalBody;
            context.Response.ContentLength = null; // length changed; let host decide
            await context.Response.Body.WriteAsync(rewritten, context.RequestAborted);
        }
        finally
        {
            context.Response.Body = originalBody;
        }
    }

    private static bool IsExemptPath(PathString path)
    {
        var value = path.Value;
        if (string.IsNullOrEmpty(value)) return false;

        // Tolerate a trailing slash, then match the whole path exactly — so
        // /api/v2/wallet/user-search-history (if one is ever added) does not
        // silently inherit the exemption.
        var trimmed = value.Length > 1 && value[^1] == '/' ? value[..^1] : value;

        foreach (var exempt in SurnamePrivacyExemptPaths)
        {
            if (string.Equals(trimmed, exempt, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static void Scrub(JsonNode? node, int? currentUserId)
    {
        switch (node)
        {
            case JsonObject obj:
                ScrubObject(obj, currentUserId);
                foreach (var kv in obj.ToList())
                {
                    Scrub(kv.Value, currentUserId);
                }
                break;
            case JsonArray arr:
                foreach (var item in arr)
                {
                    Scrub(item, currentUserId);
                }
                break;
        }
    }

    private static void ScrubObject(JsonObject obj, int? currentUserId)
    {
        var hasFirstName = FirstNameKeys.Any(k => obj.ContainsKey(k));
        var hasSurname = SurnameKeys.Any(k => obj.ContainsKey(k));
        var hasUserSignal = UserShapeSignalKeys.Any(k => obj.ContainsKey(k));
        var hasComposite = CompositeNameKeys.Any(k => obj.ContainsKey(k));

        if (IsPublicSellerProfile(obj))
        {
            return;
        }

        // An object is "user-shaped" if it carries any of: an explicit
        // first/last name, or a composite name field alongside a user-signal
        // (avatar/email/handle/user_id). Plain composite names without any
        // user signal (e.g. group.name, listing.title) are left alone.
        //
        // The second clause is a heuristic and it misfires on non-people that
        // legitimately have a name and a picture, so a non-user marker vetoes
        // it. An explicit first/last name is not a heuristic and is never
        // vetoed — that path must keep scrubbing whatever else is on the object.
        var looksLikeANonPerson = NonUserShapeSignalKeys.Any(k => obj.ContainsKey(k));
        var isUserShaped = hasFirstName || hasSurname
            || (hasComposite && hasUserSignal && !looksLikeANonPerson);

        if (!isUserShaped)
        {
            return;
        }

        if (IsSelf(obj, currentUserId))
        {
            return;
        }

        // Blank any explicit surname field.
        foreach (var key in SurnameKeys)
        {
            if (obj.ContainsKey(key))
            {
                obj[key] = JsonValue.Create(string.Empty);
            }
        }

        // 🔴 An organisation stops here. Laravel unsets the surname on an
        // organisation profile too (done above), but never replaces its
        // composite `name` with a first name — see ProfileTypeKeys.
        if (IsOrganisationProfile(obj))
        {
            return;
        }

        // Determine the first name to use for rewriting composite fields.
        // Prefer an explicit first_name sibling; otherwise derive from the
        // composite by splitting on the first run of whitespace.
        string? firstName = null;
        foreach (var k in FirstNameKeys)
        {
            if (obj.TryGetPropertyValue(k, out var v) && v is JsonValue fv)
            {
                firstName = fv.ToString();
                break;
            }
        }

        foreach (var k in CompositeNameKeys)
        {
            if (!obj.TryGetPropertyValue(k, out var v) || v is not JsonValue cv) continue;

            // STRING-ONLY GATE: only rewrite when the existing value is a
            // string. Many of these key names (created_by, posted_by) are
            // commonly integer foreign keys — mangling those would break the
            // frontend's type expectations.
            if (cv.GetValueKind() != System.Text.Json.JsonValueKind.String) continue;

            var current = cv.GetValue<string>();
            if (string.IsNullOrWhiteSpace(current)) continue;
            if (!current.Contains(' ') && string.IsNullOrWhiteSpace(firstName))
            {
                // Single-token string with no first_name to copy from — likely
                // already a first name or a handle. Leave it.
                continue;
            }

            string replacement;
            if (!string.IsNullOrWhiteSpace(firstName))
            {
                replacement = firstName!;
            }
            else
            {
                var trimmed = current.TrimStart();
                var spaceIdx = trimmed.IndexOfAny(new[] { ' ', '\t', '\n' });
                replacement = spaceIdx > 0 ? trimmed[..spaceIdx] : trimmed;
            }

            obj[k] = JsonValue.Create(replacement);
        }
    }

    /// <summary>
    /// True when the object declares itself an organisation profile. Mirrors
    /// Laravel's <c>($u['profile_type'] ?? 'individual') !== 'organisation'</c>
    /// exactly: the comparison is case-sensitive against the single value the
    /// API validates (<c>individual</c> | <c>organisation</c>), and an absent or
    /// non-string profile_type means "person", so the surname rules still apply.
    /// </summary>
    private static bool IsOrganisationProfile(JsonObject obj)
    {
        foreach (var key in ProfileTypeKeys)
        {
            if (!obj.TryGetPropertyValue(key, out var v) || v is not JsonValue jv) continue;
            if (jv.GetValueKind() != System.Text.Json.JsonValueKind.String) continue;
            if (string.Equals(jv.GetValue<string>(), OrganisationProfileType, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }

    private static bool IsPublicSellerProfile(JsonObject obj)
        => obj.ContainsKey("display_name")
            && obj.ContainsKey("seller_type")
            && obj.ContainsKey("active_listings")
            && obj.ContainsKey("marketplace_partner_badge_at");

    private static bool IsSelf(JsonObject obj, int? currentUserId)
    {
        if (!currentUserId.HasValue) return false;

        foreach (var key in IdKeys)
        {
            if (!obj.TryGetPropertyValue(key, out var v) || v is null) continue;
            if (v is JsonValue jv)
            {
                if (jv.TryGetValue<int>(out var i) && i == currentUserId.Value) return true;
                if (jv.TryGetValue<long>(out var l) && l == currentUserId.Value) return true;
                var s = jv.ToString();
                if (int.TryParse(s, out var parsed) && parsed == currentUserId.Value) return true;
            }
        }
        return false;
    }
}
