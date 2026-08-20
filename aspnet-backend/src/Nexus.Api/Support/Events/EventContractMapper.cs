// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using Nexus.Api.Entities;

namespace Nexus.Api.Support.Events;

/// <summary>
/// The canonical events contract, version 2 — a faithful port of Laravel's
/// <c>app/Support/Events/EventContractMapper.php</c> (937 lines, <c>VERSION = 2</c>).
///
/// 🔴 WHY THIS EXISTS. The canonical React frontend validates every events response at
/// runtime and FAILS CLOSED: a schema miss rewrites the response to
/// <c>success:false, code:'EVENTS_CONTRACT_DRIFT'</c>
/// (<c>react-frontend/src/lib/events-api.ts:1167-1211</c>), and all ~48 eventsApi methods
/// run through that. This backend returned a FLAT LEGACY shape, so the client rejected
/// <b>every row</b>: measured 60 drift issues on <c>/v2/events?when=upcoming</c> alone,
/// the events list rendered empty, and RSVP was unreachable because there was no event to
/// open. The endpoint returned a well-formed 200 the whole time — a response-shape diff
/// scored it as "some field names differ", which reads as cosmetic. It was not.
///
/// 🔴 THE SHAPE IS NOT NEGOTIABLE AND NOT GUESSABLE. Every key, nesting level and
/// vocabulary below is taken from Laravel's mapper and from the client's own Zod schema
/// (<c>events-api.ts:158-277</c>, which is <c>.passthrough()</c> — EXTRA keys are fine, a
/// missing or wrongly-typed key is fatal). Note in particular:
/// <list type="bullet">
/// <item><description><c>category.colour</c> — British spelling. The American spelling
/// silently fails the schema.</description></item>
/// <item><description><c>permissions</c> carries all 16 booleans; a partial object
/// fails.</description></item>
/// <item><description>Objects (<c>organizer</c>, <c>location</c>, <c>schedule</c>,
/// <c>relationship</c>, <c>online_access</c>, <c>series</c>, <c>permissions</c>,
/// <c>metrics</c>) are REQUIRED — nullable only where Laravel nulls them
/// (<c>primary_image</c>, <c>category</c>, <c>series.named</c>,
/// <c>series.recurrence</c>).</description></item>
/// <item><description>Venue accessibility uses NULLABLE booleans so "no" is never
/// confused with "the organiser did not say", and derives <c>provided</c> from whether
/// any field is non-null.</description></item>
/// </list>
///
/// 🔴 The legacy compatibility aliases at the end of <see cref="Event"/> are part of the
/// contract, not clutter. Laravel emits them and maintained clients read them —
/// <c>start_date</c> in particular: DashboardPage does <c>new Date(event.start_date)</c>,
/// and its absence previously threw a RangeError that took out a whole dashboard section.
///
/// Executable spec to port next: <c>tests/Laravel/Feature/Events/EventCanonicalContractTest.php</c>
/// and <c>EventWriterContractTest.php</c>.
/// </summary>
public static class EventContractMapper
{
    public const int Version = 2;

    /// <summary>The version served when the caller does not ask for the canonical one.</summary>
    public const int LegacyVersion = 1;

    /// <summary>The negotiation header, matching Laravel's `NegotiateEventsContract`.</summary>
    public const string ContractHeader = "X-Events-Contract";

    /// <summary>
    /// Laravel serves the canonical contract ONLY when the caller asks for it by exact
    /// value; anything else — absent, blank, "1", "3", junk — gets legacy v1
    /// (`EventsController::eventContractVersion()`, `NegotiateEventsContract`).
    /// </summary>
    public static int NegotiateVersion(string? requestedHeader) =>
        (requestedHeader ?? string.Empty).Trim() == Version.ToString(CultureInfo.InvariantCulture)
            ? Version
            : LegacyVersion;

    /// <summary>
    /// Downgrades a canonical v2 projection to the legacy v1 shape, in place.
    ///
    /// 🔴 WHY THIS EXISTS. Porting the v2 mapper without the negotiation made this backend
    /// serve v2 to EVERY caller, while Laravel serves v1 to anyone who does not send
    /// `X-Events-Contract: 2`. Three React surfaces call the events list WITHOUT that
    /// header — the dashboard (`DashboardPage.tsx:286`), group detail
    /// (`pages/groups/api/groupDetail.ts:383`) and the Verein federation panel
    /// (`VereinFederationPanel.tsx:152`) — and they share the legacy `Event` type, which
    /// declares `location?: string`. The dashboard renders `{event.location}` directly
    /// (`:572`), so an object there threw "Objects are not valid as a React child" and took
    /// the whole dashboard down. Found by the browser smoke; the field diff had scored the
    /// endpoint as fixed, because a diff compares the shape you ASKED for.
    ///
    /// 🔴 WHAT THIS IS NOT. Laravel's v1 is a raw Eloquent row: 77 keys, including 43 this
    /// projection does not have (`timezone_source`, the nine flat `accessibility_*` columns,
    /// `calendar_sequence`, `occurrence_key`, and so on). This does NOT reproduce them.
    /// Measured rather than assumed: of the 34 keys the two Laravel shapes share, exactly
    /// ONE changes type — `location`, string in v1 and object in v2 — and none of the three
    /// v1 callers reads any of the 43 v1-only columns (checked in context; the apparent
    /// `award` and `user_id` hits are a Lucide icon import and query-string parameters).
    /// So this downgrade covers the whole measured incompatibility. The absent raw columns
    /// remain a documented gap, to be filled if a caller is ever found that reads one.
    /// </summary>
    public static Dictionary<string, object?> DowngradeToLegacy(Dictionary<string, object?> canonical)
    {
        // v1 carries no version marker at all — its absence is how a client tells the
        // shapes apart, so this must be removed rather than set to 1.
        canonical.Remove("contract_version");

        // The one measured type collision. `location_label` already carries the same string
        // and is left in place: it is additive and harmless to a v1 client.
        if (canonical.TryGetValue("location", out var location)
            && location is Dictionary<string, object?> structured)
        {
            canonical["location"] = structured.TryGetValue("label", out var label) ? label : null;
        }

        return canonical;
    }

    /// <summary>Laravel's MAINTAINED_RECURRENCE_ENGINE / _VERSION.</summary>
    private const string MaintainedRecurrenceEngine = "sabre-vobject";
    private const string MaintainedRecurrenceEngineVersion = "2";

    /// <summary>
    /// Viewer-dependent facts the entity cannot know. Laravel passes these as a `$facts`
    /// array assembled by the controller from policy checks and aggregate counts; this is
    /// the typed equivalent. Defaults are the SAFE ones: a viewer with no abilities.
    ///
    /// 🔴 Defaulting an ability to `true` would advertise a capability the backend does not
    /// enforce, which is worse than a missing feature — the client would render a control
    /// that fails on use.
    /// </summary>
    public sealed class Facts
    {
        public int? ViewerId { get; init; }
        public string? LegacyRsvpStatus { get; init; }
        public int ConfirmedCount { get; init; }
        public int InterestedCount { get; init; }
        public int WaitlistCount { get; init; }
        public int? WaitlistPosition { get; init; }
        public string? Timezone { get; init; }
        public bool CanEdit { get; init; }
        public bool CanPublish { get; init; }
        public bool CanSubmitForReview { get; init; }
        public bool CanMessageOrganizer { get; init; }
        public bool CanRegister { get; init; }
        public bool CanWithdraw { get; init; }
        public bool CanJoinWaitlist { get; init; }
        public bool CanLeaveWaitlist { get; init; }
        public bool CanSetInterest { get; init; }
        public bool Manage { get; init; }
        public bool ViewRoster { get; init; }
        public bool ViewWaitlist { get; init; }
        public bool ManageAttendance { get; init; }
        public bool ViewMeetingLink { get; init; }
        public string? CategoryName { get; init; }
        public string? CategorySlug { get; init; }
        public string? CategoryColour { get; init; }
    }

    public static Dictionary<string, object?> Event(Entities.Event e, Facts? facts = null)
    {
        var f = facts ?? new Facts();

        var organizer = Organizer(e, f);
        var category = Category(e, f);
        var location = Location(e);
        var schedule = Schedule(e, f);
        var metrics = Metrics(f);
        var relationship = Relationship(e, f, metrics);
        var permissions = Permissions(f);
        var onlineAccess = OnlineAccess(e, f);
        var series = Series(e);
        var primaryImage = PrimaryImage(e);

        var capacity = (Dictionary<string, object?>)relationship["capacity"]!;

        var result = new Dictionary<string, object?>
        {
            ["contract_version"] = Version,
            ["id"] = e.Id,
            ["title"] = e.Title ?? string.Empty,
            ["description"] = NullIfBlank(e.Description),
            ["primary_image"] = primaryImage,
            ["organizer"] = organizer,
            ["category"] = category,
            ["location"] = location,
            ["schedule"] = schedule,
            ["relationship"] = relationship,
            ["online_access"] = onlineAccess,
            ["series"] = series,
            ["permissions"] = permissions,
            ["metrics"] = metrics,
            ["created_at"] = Iso(e.CreatedAt),
            ["updated_at"] = Iso(e.UpdatedAt),

            // ── Non-conflicting compatibility aliases the maintained clients read ──
            ["organizer_id"] = organizer["id"],
            ["user"] = new Dictionary<string, object?>
            {
                ["id"] = organizer["id"],
                ["name"] = organizer["display_name"],
                ["avatar"] = organizer["avatar_url"],
                ["avatar_url"] = organizer["avatar_url"],
            },
            ["category_id"] = category?["id"],
            ["category_name"] = category?["name"],
            ["category_slug"] = category?["slug"],
            ["location_label"] = location["label"],
            ["latitude"] = location["latitude"],
            ["longitude"] = location["longitude"],
            ["coordinates"] = location["latitude"] is not null && location["longitude"] is not null
                ? new Dictionary<string, object?> { ["lat"] = location["latitude"], ["lng"] = location["longitude"] }
                : null,
            ["venue_accessibility"] = location["accessibility"],
            ["start_time"] = schedule["start_at"],
            ["end_time"] = schedule["end_at"],
            // 🔴 start_date/end_date: DashboardPage.tsx does `new Date(event.start_date)`.
            ["start_date"] = schedule["start_at"],
            ["end_date"] = schedule["end_at"],
            ["status"] = NullIfBlank(e.Status) ?? "active",
            ["cancellation_reason"] = schedule["cancellation_reason"],
            ["is_online"] = e.IsOnline,
            ["allow_remote_attendance"] = e.AllowRemoteAttendance,
            ["online_link"] = onlineAccess["join_url"],
            ["online_url"] = onlineAccess["join_url"],
            ["video_url"] = onlineAccess["video_url"],
            ["cover_image"] = primaryImage?["url"],
            ["image_url"] = primaryImage?["url"],
            ["max_attendees"] = capacity["limit"],
            ["spots_left"] = capacity["remaining"],
            ["is_full"] = capacity["is_full"],
            ["attendee_count"] = metrics["confirmed_count"],
            ["attendees_count"] = metrics["confirmed_count"],
            ["interested_count"] = metrics["interested_count"],
            ["waitlist_count"] = metrics["waitlist_count"],
            ["rsvp_counts"] = new Dictionary<string, object?>
            {
                ["going"] = metrics["confirmed_count"],
                ["interested"] = metrics["interested_count"],
            },
            ["my_rsvp"] = NullIfBlank(f.LegacyRsvpStatus),
            ["user_rsvp"] = NullIfBlank(f.LegacyRsvpStatus),
            ["rsvp_status"] = NullIfBlank(f.LegacyRsvpStatus),
            ["series_id"] = (series["named"] as Dictionary<string, object?>)?["id"],
            ["is_series"] = series["recurrence"] is not null,
            ["parent_event_id"] = (series["recurrence"] as Dictionary<string, object?>)?["parent_event_id"],
            ["recurrence_frequency"] = (series["recurrence"] as Dictionary<string, object?>)?["frequency"],
            ["series_count"] = (series["recurrence"] as Dictionary<string, object?>)?["occurrence_count"],
            ["series_occurrences"] = (series["recurrence"] as Dictionary<string, object?>)?["occurrences"]
                ?? new List<Dictionary<string, object?>>(),
            ["can_edit"] = permissions["edit"],
            ["group"] = e.Group is null
                ? null
                : new Dictionary<string, object?>
                {
                    ["id"] = e.Group.Id,
                    ["name"] = e.Group.Name ?? string.Empty,
                    // 🔴 The Group entity has no Slug column. Laravel emits one, so the
                    // key must EXIST (the client reads group.slug) but its honest value
                    // here is null — inventing a slug from the name would be fabricated
                    // data, which is the fault class this workstream keeps finding.
                    ["slug"] = null,
                },
        };

        // Member-facing only, and only a configured positive reward is worth sending.
        if (e.AttendanceCreditAmount is > 0)
        {
            result["attendance_credit_amount"] = Math.Round((decimal)e.AttendanceCreditAmount, 2);
        }

        return result;
    }

    /// <summary>
    /// One attendee row for the event roster — Laravel's <c>roster()</c>
    /// (EventContractMapper.php:410-441), same <c>contract_version</c>.
    ///
    /// 🔴 Needed because the roster is validated SEPARATELY. Fixing the list and the
    /// detail view still left <c>/v2/events/{id}/attendees</c> reporting 12 drift issues,
    /// so the RSVP control rendered but the people list behind it did not. Each surface
    /// the client schema-checks has to be mapped; there is no partial credit.
    /// </summary>
    public static Dictionary<string, object?> Roster(
        int userId, string? displayName, string? avatarUrl, string? rsvpStatus, DateTime? rsvpAt)
    {
        var legacy = NullIfBlank(rsvpStatus);

        var engagement = new Dictionary<string, object?>
        {
            ["state"] = legacy is "interested" or "maybe" ? "interested" : "none",
            ["can_change"] = false,
        };
        var registration = new Dictionary<string, object?>
        {
            ["state"] = legacy is "going" or "attended" ? "confirmed"
                : legacy is "not_going" or "declined" ? "declined"
                : legacy == "waitlisted" ? "waitlisted"
                : legacy == "invited" ? "invited"
                : legacy == "cancelled" ? "cancelled"
                : "none",
            ["waitlist_position"] = null,
            ["can_register"] = false,
            ["can_withdraw"] = false,
            ["can_join_waitlist"] = false,
            ["can_leave_waitlist"] = false,
        };
        var attendance = new Dictionary<string, object?>
        {
            ["state"] = legacy == "attended" ? "attended" : "not_checked_in",
            ["checked_in_at"] = null,
            ["checked_out_at"] = null,
        };

        return new Dictionary<string, object?>
        {
            ["contract_version"] = Version,
            ["member"] = new Dictionary<string, object?>
            {
                ["id"] = userId,
                ["display_name"] = NullIfBlank(displayName),
                ["avatar_url"] = NullIfBlank(avatarUrl),
            },
            ["engagement"] = engagement,
            ["registration"] = registration,
            ["attendance"] = attendance,
            ["registered_at"] = Iso(rsvpAt),

            // Compatibility aliases Laravel also emits.
            ["id"] = userId,
            ["name"] = NullIfBlank(displayName),
            ["avatar"] = NullIfBlank(avatarUrl),
            ["avatar_url"] = NullIfBlank(avatarUrl),
            ["rsvp_status"] = legacy,
            ["status"] = legacy,
            ["rsvp_at"] = Iso(rsvpAt),
        };
    }

    private static Dictionary<string, object?> Organizer(Entities.Event e, Facts f)
    {
        var id = e.CreatedById;
        var name = e.CreatedBy is null
            ? null
            : NullIfBlank($"{e.CreatedBy.FirstName} {e.CreatedBy.LastName}".Trim());

        return new Dictionary<string, object?>
        {
            ["id"] = id,
            ["display_name"] = name,
            ["avatar_url"] = e.CreatedBy?.AvatarUrl,
            ["relationship"] = f.ViewerId is not null && f.ViewerId == id ? "self" : "member",
            ["actions"] = new Dictionary<string, object?>
            {
                ["view_profile"] = id > 0,
                ["message"] = f.CanMessageOrganizer,
            },
        };
    }

    /// <summary>Null when NOTHING is known, exactly as Laravel does — not an empty object.</summary>
    private static Dictionary<string, object?>? Category(Entities.Event e, Facts f)
    {
        var id = e.CategoryId;
        var name = NullIfBlank(f.CategoryName);
        var slug = NullIfBlank(f.CategorySlug);
        var colour = NullIfBlank(f.CategoryColour);

        if (id is null && name is null && slug is null && colour is null)
        {
            return null;
        }

        return new Dictionary<string, object?>
        {
            ["id"] = id,
            ["name"] = name,
            ["slug"] = slug,
            // 🔴 British spelling. `color` fails the client schema.
            ["colour"] = colour,
        };
    }

    private static Dictionary<string, object?> Location(Entities.Event e)
    {
        var label = NullIfBlank(e.Location);
        var remote = e.IsOnline
            || e.AllowRemoteAttendance
            || NullIfBlank(e.OnlineLink) is not null
            || NullIfBlank(e.VideoUrl) is not null;

        var mode = remote && label is not null ? "hybrid" : remote ? "online" : "in_person";

        return new Dictionary<string, object?>
        {
            ["label"] = label,
            ["latitude"] = e.Latitude,
            ["longitude"] = e.Longitude,
            ["mode"] = mode,
            ["accessibility"] = VenueAccessibility(e),
        };
    }

    /// <summary>
    /// Nullable booleans throughout: "no" must never be confused with "not stated".
    /// <c>provided</c> is derived, never stored.
    /// </summary>
    private static Dictionary<string, object?> VenueAccessibility(Entities.Event e)
    {
        var result = new Dictionary<string, object?>
        {
            ["schema_version"] = 1,
            ["step_free_access"] = e.AccessibilityStepFree,
            ["accessible_toilet"] = e.AccessibilityToilet,
            ["hearing_loop"] = e.AccessibilityHearingLoop,
            ["quiet_space"] = e.AccessibilityQuietSpace,
            ["seating_available"] = e.AccessibilitySeating,
            ["accessible_parking"] = e.AccessibilityParking,
            ["parking_details"] = NullIfBlank(e.AccessibilityParkingDetails),
            ["transit_details"] = NullIfBlank(e.AccessibilityTransitDetails),
            ["assistance_contact"] = NullIfBlank(e.AccessibilityAssistanceContact),
            ["notes"] = NullIfBlank(e.AccessibilityNotes),
        };

        result["provided"] = result.Any(kv => kv.Key != "schema_version" && kv.Value is not null);
        return result;
    }

    private static Dictionary<string, object?> Schedule(Entities.Event e, Facts f)
    {
        var publication = NormalisePublication(e.PublicationStatus);
        var operational = NormaliseOperational(e.OperationalStatus, e.IsCancelled);
        var now = DateTime.UtcNow;
        var start = e.StartsAt;
        var end = e.EndsAt;

        var state = publication switch
        {
            "pending_review" => "pending_review",
            "draft" => "draft",
            "archived" => "archived",
            _ => operational switch
            {
                "postponed" => "postponed",
                "cancelled" => "cancelled",
                "completed" => "completed",
                _ => start > now ? "upcoming"
                    : end is not null && end < now ? "ended"
                    : start <= now ? "ongoing"
                    : "upcoming",
            },
        };

        return new Dictionary<string, object?>
        {
            ["start_at"] = Iso(start),
            ["end_at"] = Iso(end),
            ["timezone"] = NullIfBlank(e.Timezone) ?? NullIfBlank(f.Timezone) ?? "UTC",
            ["all_day"] = e.AllDay,
            ["state"] = state,
            ["publication_state"] = publication,
            ["operational_state"] = operational,
            ["lifecycle_version"] = e.LifecycleVersion,
            // The attendee-visible field only. Never fall back to moderation metadata.
            ["cancellation_reason"] = operational == "cancelled" ? NullIfBlank(e.CancellationReason) : null,
        };
    }

    private static Dictionary<string, object?> Relationship(
        Entities.Event e, Facts f, Dictionary<string, object?> metrics)
    {
        var legacy = NullIfBlank(f.LegacyRsvpStatus);

        var engagement = legacy is "interested" or "maybe" ? "interested" : "none";

        var registration = f.WaitlistPosition is not null || legacy == "waitlisted" ? "waitlisted"
            : legacy == "invited" ? "invited"
            : legacy is "going" or "attended" ? "confirmed"
            : legacy is "not_going" or "declined" ? "declined"
            : legacy == "cancelled" ? "cancelled"
            : "none";

        var attendance = legacy == "attended" ? "attended" : "not_checked_in";

        var confirmed = (int)(metrics["confirmed_count"] ?? 0);
        var limit = e.MaxAttendees;
        var remaining = limit is not null ? Math.Max(0, limit.Value - confirmed) : (int?)null;

        return new Dictionary<string, object?>
        {
            ["engagement"] = new Dictionary<string, object?>
            {
                ["state"] = engagement,
                ["can_change"] = f.CanSetInterest,
            },
            ["registration"] = new Dictionary<string, object?>
            {
                ["state"] = registration,
                ["waitlist_position"] = f.WaitlistPosition,
                ["can_register"] = f.CanRegister,
                ["can_withdraw"] = f.CanWithdraw,
                ["can_join_waitlist"] = f.CanJoinWaitlist,
                ["can_leave_waitlist"] = f.CanLeaveWaitlist,
            },
            ["attendance"] = new Dictionary<string, object?>
            {
                ["state"] = attendance,
                ["checked_in_at"] = null,
                ["checked_out_at"] = null,
            },
            ["capacity"] = new Dictionary<string, object?>
            {
                ["limit"] = limit,
                ["confirmed"] = confirmed,
                ["remaining"] = remaining,
                ["is_full"] = limit is not null && confirmed >= limit.Value,
                ["waitlist_count"] = metrics["waitlist_count"],
            },
        };
    }

    /// <summary>All 16 booleans. A partial object fails the client schema.</summary>
    private static Dictionary<string, object?> Permissions(Facts f) => new()
    {
        ["edit"] = f.CanEdit || f.Manage,
        ["cancel"] = f.Manage,
        ["manage_people"] = f.ViewRoster || f.ViewWaitlist || f.ManageAttendance,
        ["check_in"] = f.ManageAttendance,
        ["message"] = f.Manage,
        ["export"] = f.Manage,
        ["publish"] = f.CanPublish,
        ["submit_for_review"] = f.CanSubmitForReview,
        ["manage_agenda"] = f.Manage,
        ["manage_staff"] = f.Manage,
        ["manage_registration"] = f.Manage,
        ["broadcast"] = f.Manage,
        ["manage_finance"] = f.Manage,
        ["reconcile_credits"] = f.Manage,
        ["reconcile_tickets"] = f.Manage,
        ["transfer_ownership"] = f.Manage,
    };

    private static Dictionary<string, object?> Metrics(Facts f) => new()
    {
        ["confirmed_count"] = f.ConfirmedCount,
        ["interested_count"] = f.InterestedCount,
        ["waitlist_count"] = f.WaitlistCount,
    };

    /// <summary>
    /// The join link is revealed only when the viewer is eligible — mirroring Laravel's
    /// <c>onlineAccessResult</c>, where join_url/video_url are null unless the state is
    /// <c>available</c>. Leaking a meeting link to an ineligible viewer is the failure
    /// mode this guards.
    /// </summary>
    private static Dictionary<string, object?> OnlineAccess(Entities.Event e, Facts f)
    {
        var remote = e.IsOnline || e.AllowRemoteAttendance;
        var join = NullIfBlank(e.OnlineLink);
        var video = NullIfBlank(e.VideoUrl);
        var mode = remote && NullIfBlank(e.Location) is not null ? "hybrid"
            : remote ? "online" : "in_person";

        var configured = join is not null || video is not null;
        var eligible = f.ViewMeetingLink || f.Manage;

        var revealState = !remote && !configured ? "not_applicable"
            : !configured ? "not_configured"
            : !eligible ? "restricted"
            : "available";

        return new Dictionary<string, object?>
        {
            ["mode"] = mode,
            ["reveal_state"] = revealState,
            ["join_url"] = revealState == "available" ? join : null,
            ["video_url"] = revealState == "available" ? video : null,
            ["reveal_at"] = null,
            ["expires_at"] = null,
        };
    }

    private static Dictionary<string, object?> Series(Entities.Event e)
    {
        Dictionary<string, object?>? named = e.SeriesId is not null
            ? new Dictionary<string, object?>
            {
                ["id"] = e.SeriesId,
                ["title"] = null,
                ["description"] = null,
                ["event_count"] = 0,
            }
            : null;

        var isRecurring = e.IsRecurringTemplate || e.ParentEventId is not null;
        Dictionary<string, object?>? recurrence = null;

        if (isRecurring)
        {
            // 🔴 Recurrence identity is an ALLOWLISTED manager contract, not a raw
            // projection. Templates, legacy engines and malformed ids stay explicit nulls
            // so clients fail closed rather than trusting an unverified identity.
            var maintained = !e.IsRecurringTemplate
                && e.ParentEventId is not null
                && e.RecurrenceId is not null
                && System.Text.RegularExpressions.Regex.IsMatch(
                    e.RecurrenceId, @"^[0-9]{8}T[0-9]{6}Z$")
                && e.RecurrenceEngine == MaintainedRecurrenceEngine
                && e.RecurrenceEngineVersion == MaintainedRecurrenceEngineVersion;

            recurrence = new Dictionary<string, object?>
            {
                ["parent_event_id"] = e.ParentEventId,
                ["root_event_id"] = e.ParentEventId ?? e.Id,
                ["is_template"] = e.IsRecurringTemplate,
                ["recurrence_id"] = maintained ? e.RecurrenceId : null,
                ["engine"] = maintained ? MaintainedRecurrenceEngine : null,
                ["engine_version"] = maintained ? MaintainedRecurrenceEngineVersion : null,
                ["frequency"] = null,
                ["interval"] = 1,
                ["rrule"] = null,
                ["occurrence_count"] = 0,
                ["occurrences"] = new List<Dictionary<string, object?>>(),
            };
        }

        return new Dictionary<string, object?>
        {
            ["named"] = named,
            ["recurrence"] = recurrence,
        };
    }

    private static Dictionary<string, object?>? PrimaryImage(Entities.Event e)
    {
        var url = NullIfBlank(e.ImageUrl);
        if (url is null)
        {
            return null;
        }

        return new Dictionary<string, object?>
        {
            ["url"] = url,
            ["alt_text"] = e.Title ?? string.Empty,
        };
    }

    private static string NormalisePublication(string? raw) => (raw ?? string.Empty).ToLowerInvariant() switch
    {
        "draft" => "draft",
        "pending_review" or "pending" => "pending_review",
        "archived" => "archived",
        _ => "published",
    };

    private static string NormaliseOperational(string? raw, bool isCancelled)
    {
        if (isCancelled)
        {
            return "cancelled";
        }

        return (raw ?? string.Empty).ToLowerInvariant() switch
        {
            "postponed" => "postponed",
            "cancelled" => "cancelled",
            "completed" => "completed",
            _ => "scheduled",
        };
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>ISO-8601 with an offset, matching Laravel's <c>toIso8601String()</c>.</summary>
    private static string? Iso(DateTime? value) => value is null
        ? null
        : new DateTimeOffset(DateTime.SpecifyKind(value.Value, DateTimeKind.Utc)).ToString("yyyy-MM-ddTHH:mm:sszzz");
}
