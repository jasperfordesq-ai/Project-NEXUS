// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * public/robots.txt read the way Google reads it (RFC 9309 plus Google's
 * longest-match rule: the matching rule with the longest path wins, and an
 * Allow wins a tie).
 *
 * Until 2026-10-23 every rule was a bare prefix, so "/feed" also blocked
 * /feedback and "/*\/messages" blocked the public help guide
 * /help/members/messages.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import membersRegistry from '@/pages/help/guides/data/members.registry.json';
import brokersRegistry from '@/pages/help/guides/data/brokers.registry.json';
import adminsRegistry from '@/pages/help/guides/data/admins.registry.json';

type Rule = { allow: boolean; path: string; re: RegExp };

const robots = readFileSync(resolve(__dirname, '../../public/robots.txt'), 'utf8');

const rules: Rule[] = robots
  .split(/\r?\n/)
  .map((line) => /^(Allow|Disallow):\s*(\S+)\s*$/.exec(line))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((match) => {
    const kind = match[1] ?? '';
    const path = match[2] ?? '';
    const anchored = path.endsWith('$');
    const body = (anchored ? path.slice(0, -1) : path)
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return { allow: kind === 'Allow', path, re: new RegExp(`^${body}${anchored ? '$' : ''}`) };
  });

function allowed(url: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!rule.re.test(url)) continue;
    if (
      best === null ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best === null || best.allow;
}

type Registry = { id: string; articles: { id: string }[] }[];
const registries: Record<string, Registry> = {
  members: membersRegistry as Registry,
  brokers: brokersRegistry as Registry,
  admins: adminsRegistry as Registry,
};

describe('robots.txt', () => {
  it.each([
    '/dashboard', '/dashboard/', '/dashboard?tab=1', '/login', '/login?redirect=/wallet',
    '/messages/42', '/hour-timebank/wallet', '/hour-timebank/members', '/settings/security',
    '/listings/5/edit', '/hour-timebank/listings/5/edit', '/admin/seo', '/api/v2/me',
  ])('blocks the private page %s', (url) => {
    expect(allowed(url)).toBe(false);
  });

  it.each([
    '/', '/about', '/feedback', '/membership', '/searching-for-help', '/blog/feed-the-hungry',
    '/blog/chatting-over-tea', '/hour-timebank/about', '/whats-on', '/whats-on/12', '/help',
    '/listings/5/editors-pick',
  ])('allows the public page %s', (url) => {
    expect(allowed(url)).toBe(true);
  });

  it('allows every help guide, at the root and in a community folder', () => {
    const blocked: string[] = [];
    for (const [audience, sections] of Object.entries(registries)) {
      const paths = [`/help/${audience}`];
      for (const section of sections) {
        paths.push(`/help/${audience}/${section.id}`);
        for (const article of section.articles) {
          paths.push(`/help/${audience}/${section.id}/${article.id}`);
        }
      }
      for (const path of paths) {
        for (const url of [path, `/hour-timebank${path}`]) {
          if (!allowed(url)) blocked.push(url);
        }
      }
    }
    expect(blocked).toEqual([]);
  });
});
