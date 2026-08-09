// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Audit Logger for Admin Actions
 * Logs administrative actions for compliance and security monitoring.
 */

const AUDIT_ACTIONS = {
  // User management
  USER_VIEW: 'user.view',
  USER_UPDATE: 'user.update',
  USER_SUSPEND: 'user.suspend',
  USER_ACTIVATE: 'user.activate',

  // Content moderation
  LISTING_APPROVE: 'listing.approve',
  LISTING_REJECT: 'listing.reject',

  // Category management
  CATEGORY_CREATE: 'category.create',
  CATEGORY_UPDATE: 'category.update',
  CATEGORY_DELETE: 'category.delete',

  // Configuration
  CONFIG_UPDATE: 'config.update',

  // Role management
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',

  // User-generated content - Listings
  LISTING_CREATE: 'listing.create',
  LISTING_UPDATE: 'listing.update',
  LISTING_DELETE: 'listing.delete',

  // User-generated content - Feed
  FEED_POST_CREATE: 'feed.post.create',
  FEED_POST_UPDATE: 'feed.post.update',
  FEED_POST_DELETE: 'feed.post.delete',
  FEED_COMMENT_CREATE: 'feed.comment.create',
  FEED_COMMENT_DELETE: 'feed.comment.delete',

  // User-generated content - Groups
  GROUP_CREATE: 'group.create',
  GROUP_UPDATE: 'group.update',
  GROUP_DELETE: 'group.delete',
  GROUP_JOIN: 'group.join',
  GROUP_LEAVE: 'group.leave',

  // User-generated content - Events
  EVENT_CREATE: 'event.create',
  EVENT_UPDATE: 'event.update',
  EVENT_DELETE: 'event.delete',
  EVENT_RSVP: 'event.rsvp',

  // Messages
  MESSAGE_SEND: 'message.send',
  CONVERSATION_CREATE: 'conversation.create',

  // Wallet
  WALLET_TRANSFER: 'wallet.transfer',

  // Reviews
  REVIEW_CREATE: 'review.create',
  REVIEW_DELETE: 'review.delete',

  // Reports
  REPORT_CREATE: 'report.create'
};

/**
 * Log an admin action
 * @param {Object} options
 * @param {string} options.action - The action being performed (from AUDIT_ACTIONS)
 * @param {Object} options.actor - The user performing the action
 * @param {string|number} options.targetId - The ID of the affected resource
 * @param {string} options.targetType - The type of resource (user, listing, category, etc.)
 * @param {Object} options.details - Additional details about the action
 * @param {string} options.ip - IP address of the request
 */
function logAuditEvent({ action, actor, targetId, targetType, details = {}, ip }) {
  const timestamp = new Date().toISOString();

  const auditEntry = {
    timestamp,
    action,
    actor: {
      id: actor?.id,
      email: actor?.email,
      role: actor?.role
    },
    target: {
      id: targetId,
      type: targetType
    },
    details,
    ip,
    source: 'nexus-uk-frontend'
  };

  // Log to console with structured format
  // In production, this could be extended to:
  // - Write to a database
  // - Send to an external logging service (e.g., CloudWatch, Datadog)
  // - Write to a file
  console.log('[AUDIT]', JSON.stringify(auditEntry));

  return auditEntry;
}

/**
 * Express middleware factory for audit logging
 * @param {string} action - The action to log
 * @param {Function} getTargetInfo - Function to extract target info from request
 * @returns {Function} Express middleware
 */
function auditMiddleware(action, getTargetInfo) {
  return (req, res, next) => {
    // Store original end method
    const originalEnd = res.end;

    // Override end to log after successful response
    res.end = function(chunk, encoding) {
      // Only log on successful mutations (2xx or 3xx redirects)
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const targetInfo = getTargetInfo ? getTargetInfo(req) : {};

        logAuditEvent({
          action,
          actor: req.user,
          targetId: targetInfo.id || req.params.id,
          targetType: targetInfo.type || 'unknown',
          details: targetInfo.details || {},
          ip: req.ip || req.connection?.remoteAddress
        });
      }

      // Call original end
      originalEnd.call(this, chunk, encoding);
    };

    next();
  };
}

/**
 * Helper to create audit middleware for common patterns
 */
const audit = {
  userUpdate: () => auditMiddleware(AUDIT_ACTIONS.USER_UPDATE, (req) => ({
    id: req.params.id,
    type: 'user',
    details: { fields: Object.keys(req.body).filter(k => k !== '_csrf') }
  })),

  userSuspend: () => auditMiddleware(AUDIT_ACTIONS.USER_SUSPEND, (req) => ({
    id: req.params.id,
    type: 'user',
    details: { reason: req.body.reason || 'No reason provided' }
  })),

  userActivate: () => auditMiddleware(AUDIT_ACTIONS.USER_ACTIVATE, (req) => ({
    id: req.params.id,
    type: 'user'
  })),

  listingApprove: () => auditMiddleware(AUDIT_ACTIONS.LISTING_APPROVE, (req) => ({
    id: req.params.id,
    type: 'listing'
  })),

  listingReject: () => auditMiddleware(AUDIT_ACTIONS.LISTING_REJECT, (req) => ({
    id: req.params.id,
    type: 'listing',
    details: { reason: req.body.reason || 'No reason provided' }
  })),

  categoryCreate: () => auditMiddleware(AUDIT_ACTIONS.CATEGORY_CREATE, (req) => ({
    type: 'category',
    details: { name: req.body.name }
  })),

  categoryUpdate: () => auditMiddleware(AUDIT_ACTIONS.CATEGORY_UPDATE, (req) => ({
    id: req.params.id,
    type: 'category',
    details: { name: req.body.name }
  })),

  categoryDelete: () => auditMiddleware(AUDIT_ACTIONS.CATEGORY_DELETE, (req) => ({
    id: req.params.id,
    type: 'category'
  })),

  configUpdate: () => auditMiddleware(AUDIT_ACTIONS.CONFIG_UPDATE, (req) => ({
    type: 'config',
    details: { keys: Object.keys(req.body).filter(k => k !== '_csrf') }
  })),

  roleCreate: () => auditMiddleware(AUDIT_ACTIONS.ROLE_CREATE, (req) => ({
    type: 'role',
    details: { name: req.body.name }
  })),

  roleUpdate: () => auditMiddleware(AUDIT_ACTIONS.ROLE_UPDATE, (req) => ({
    id: req.params.id,
    type: 'role',
    details: { name: req.body.name }
  })),

  roleDelete: () => auditMiddleware(AUDIT_ACTIONS.ROLE_DELETE, (req) => ({
    id: req.params.id,
    type: 'role'
  })),

  // User-generated content auditing
  listingCreate: () => auditMiddleware(AUDIT_ACTIONS.LISTING_CREATE, (req) => ({
    type: 'listing',
    details: { title: req.body.title }
  })),

  listingUpdate: () => auditMiddleware(AUDIT_ACTIONS.LISTING_UPDATE, (req) => ({
    id: req.params.id,
    type: 'listing',
    details: { title: req.body.title }
  })),

  listingDelete: () => auditMiddleware(AUDIT_ACTIONS.LISTING_DELETE, (req) => ({
    id: req.params.id,
    type: 'listing'
  })),

  feedPostCreate: () => auditMiddleware(AUDIT_ACTIONS.FEED_POST_CREATE, (req) => ({
    type: 'feed_post',
    details: { hasImage: !!req.body.image_url, groupId: req.body.group_id }
  })),

  feedPostUpdate: () => auditMiddleware(AUDIT_ACTIONS.FEED_POST_UPDATE, (req) => ({
    id: req.params.id,
    type: 'feed_post'
  })),

  feedPostDelete: () => auditMiddleware(AUDIT_ACTIONS.FEED_POST_DELETE, (req) => ({
    id: req.params.id,
    type: 'feed_post'
  })),

  feedCommentCreate: () => auditMiddleware(AUDIT_ACTIONS.FEED_COMMENT_CREATE, (req) => ({
    id: req.params.id,
    type: 'feed_comment',
    details: { postId: req.params.id }
  })),

  feedCommentDelete: () => auditMiddleware(AUDIT_ACTIONS.FEED_COMMENT_DELETE, (req) => ({
    id: req.params.commentId,
    type: 'feed_comment',
    details: { postId: req.params.id }
  })),

  groupCreate: () => auditMiddleware(AUDIT_ACTIONS.GROUP_CREATE, (req) => ({
    type: 'group',
    details: { name: req.body.name }
  })),

  groupUpdate: () => auditMiddleware(AUDIT_ACTIONS.GROUP_UPDATE, (req) => ({
    id: req.params.id,
    type: 'group',
    details: { name: req.body.name }
  })),

  groupDelete: () => auditMiddleware(AUDIT_ACTIONS.GROUP_DELETE, (req) => ({
    id: req.params.id,
    type: 'group'
  })),

  groupJoin: () => auditMiddleware(AUDIT_ACTIONS.GROUP_JOIN, (req) => ({
    id: req.params.id,
    type: 'group'
  })),

  groupLeave: () => auditMiddleware(AUDIT_ACTIONS.GROUP_LEAVE, (req) => ({
    id: req.params.id,
    type: 'group'
  })),

  eventCreate: () => auditMiddleware(AUDIT_ACTIONS.EVENT_CREATE, (req) => ({
    type: 'event',
    details: { title: req.body.title }
  })),

  eventUpdate: () => auditMiddleware(AUDIT_ACTIONS.EVENT_UPDATE, (req) => ({
    id: req.params.id,
    type: 'event',
    details: { title: req.body.title }
  })),

  eventDelete: () => auditMiddleware(AUDIT_ACTIONS.EVENT_DELETE, (req) => ({
    id: req.params.id,
    type: 'event'
  })),

  eventRsvp: () => auditMiddleware(AUDIT_ACTIONS.EVENT_RSVP, (req) => ({
    id: req.params.id,
    type: 'event',
    details: { status: req.body.status }
  })),

  messageSend: () => auditMiddleware(AUDIT_ACTIONS.MESSAGE_SEND, (req) => ({
    id: req.params.id,
    type: 'conversation'
  })),

  conversationCreate: () => auditMiddleware(AUDIT_ACTIONS.CONVERSATION_CREATE, (req) => ({
    type: 'conversation',
    details: { recipientId: req.body.recipient_id }
  })),

  walletTransfer: () => auditMiddleware(AUDIT_ACTIONS.WALLET_TRANSFER, (req) => ({
    type: 'wallet_transfer',
    details: {
      recipientId: req.body.recipient_id,
      amount: req.body.amount
    }
  })),

  reviewCreate: () => auditMiddleware(AUDIT_ACTIONS.REVIEW_CREATE, (req) => ({
    type: 'review',
    details: {
      listingId: req.params.id,
      rating: req.body.rating
    }
  })),

  reviewDelete: () => auditMiddleware(AUDIT_ACTIONS.REVIEW_DELETE, (req) => ({
    id: req.params.id,
    type: 'review'
  })),

  reportCreate: () => auditMiddleware(AUDIT_ACTIONS.REPORT_CREATE, (req) => ({
    type: 'report',
    details: {
      reportType: req.body.type,
      targetType: req.body.target_type,
      targetId: req.body.target_id
    }
  }))
};

module.exports = {
  AUDIT_ACTIONS,
  logAuditEvent,
  auditMiddleware,
  audit
};
