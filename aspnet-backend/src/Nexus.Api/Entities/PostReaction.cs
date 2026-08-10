// Copyright (C) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Emoji reaction on a feed post. One reaction per user per post.
/// </summary>
public class PostReaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PostId { get; set; }
    public int UserId { get; set; }

    /// <summary>Reaction type: "like", "love", "laugh", "sad", "angry", "wow".</summary>
    [MaxLength(20)]
    public string ReactionType { get; set; } = "like";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public FeedPost? Post { get; set; }
    public User? User { get; set; }

    public static class Types
    {
        public const string Like = "like";
        public const string Love = "love";
        public const string Laugh = "laugh";
        public const string Sad = "sad";
        public const string Angry = "angry";
        public const string Wow = "wow";
        public static readonly string[] All = { Like, Love, Laugh, Sad, Angry, Wow };
    }
}
