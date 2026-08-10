// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class MessageAttachment
{
    public int Id { get; set; }
    public int MessageId { get; set; }
    public int FileUploadId { get; set; }
    public int UploadedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Message? Message { get; set; }
    public FileUpload? FileUpload { get; set; }
    public User? UploadedBy { get; set; }
}
