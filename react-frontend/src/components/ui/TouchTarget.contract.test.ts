// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');

interface Control {
  opening: ts.JsxOpeningLikeElement;
  source: ts.SourceFile;
  tag: string;
}

function parse(relativePath: string): ts.SourceFile {
  const path = join(SOURCE_ROOT, relativePath);
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function openingElement(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

function controlsContaining(relativePath: string, marker: string): Control[] {
  const source = parse(relativePath);
  const controls: Control[] = [];

  const visit = (node: ts.Node) => {
    const opening = openingElement(node);
    const tag = opening?.tagName.getText(source);
    if (
      opening &&
      (tag === 'Button' || tag === 'OverlayActionButton') &&
      opening.getText(source).includes(marker)
    ) {
      controls.push({ opening, source, tag });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return controls;
}

function hasGuaranteedTarget(control: Control): boolean {
  if (control.tag === 'OverlayActionButton') return true;
  const opening = control.opening.getText(control.source);
  if (!opening.includes('isIconOnly')) return opening.includes('min-h-11');
  return ['size-11', 'min-h-11', 'min-w-11'].every((token) => opening.includes(token));
}

const TARGETS = [
  ['pages/marketplace/CreateMarketplaceListingPage.tsx', "create.remove_image", 1],
  ['pages/marketplace/CreateMarketplaceListingPage.tsx', "create.remove_video", 1],
  ['pages/groups/tabs/GroupMediaTab.tsx', "media.delete_aria", 2],
  ['pages/groups/tabs/GroupMediaTab.tsx', "media.close_lightbox", 1],
  ['pages/groups/tabs/GroupMediaTab.tsx', "media.prev", 1],
  ['pages/groups/tabs/GroupMediaTab.tsx', "media.next", 1],
  ['pages/explore/ExplorePage.tsx', "t('dismiss')", 1],
  ['components/explore/HorizontalScroll.tsx', "aria.scroll_left", 1],
  ['components/explore/HorizontalScroll.tsx', "aria.scroll_right", 1],
  ['components/stories/StoryHighlights.tsx', "highlights.aria_edit", 1],
  ['components/stories/StoryHighlights.tsx', "highlights.aria_delete", 1],
  ['components/stories/StoryHighlights.tsx', "highlights.aria_remove_story", 1],
  ['pages/marketplace/EditMarketplaceListingPage.tsx', "create.remove_image", 1],
  ['components/compose/MediaUploader.tsx', "aria.drag_to_reorder", 1],
  ['components/compose/MediaUploader.tsx', "compose.image_remove_number_aria", 1],
  ['components/compose/MediaUploader.tsx', "compose.alt_text_edit", 1],
  ['components/feed/ConnectionSuggestionsWidget.tsx', "suggestions.dismiss", 2],
  ['components/feed/StoriesBar.tsx', "stories.scroll_left", 1],
  ['components/feed/StoriesBar.tsx', "stories.scroll_right", 1],
  ['components/feed/WhyShown.tsx', "why_shown.label", 1],
  ['components/ideation/TeamChatrooms.tsx', "chatrooms.unpin", 2],
  ['components/ideation/TeamChatrooms.tsx', "comments.delete", 1],
  ['admin/modules/gamification/CustomBadges.tsx', "gamification.delete_badge_aria", 1],
  ['components/feed/FeedCard.tsx', "card.post_options", 2],
  ['pages/messages/components/MessageBubble.tsx', "aria_add_reaction", 1],
  ['pages/messages/components/MessageBubble.tsx', "aria_message_options", 2],
  ['pages/messages/components/MessageBubble.tsx', "key={emoji}", 3],
  ['pages/messages/components/MessageBubble.tsx', "handleTranslate", 2],
  ['pages/messages/components/MessageBubble.tsx', 'role="menuitem"', 3],
  ['pages/messages/components/MessageBubble.tsx', "onCancelEdit", 1],
  ['pages/messages/components/MessageBubble.tsx', "onSaveEdit", 1],
  ['pages/goals/components/GoalTemplatePickerModal.tsx', "template.use_template_aria", 1],
  ['components/legal/CustomLegalDocument.tsx', "scrollToSection(section.id)", 1],
] as const;

describe('audited touch-target production contracts', () => {
  it.each(TARGETS)('%s / %s keeps every action at least 44px', (path, marker, count) => {
    const controls = controlsContaining(path, marker);
    expect(controls).toHaveLength(count);
    expect(controls.every(hasGuaranteedTarget)).toBe(true);
  });

  it('uses the touch-aware overlay primitive for every formerly hover-only action', () => {
    const overlayTargets = [
      ['pages/marketplace/CreateMarketplaceListingPage.tsx', 'create.remove_image'],
      ['pages/groups/tabs/GroupMediaTab.tsx', 'media.delete_aria'],
      ['pages/explore/ExplorePage.tsx', "t('dismiss')"],
      ['components/explore/HorizontalScroll.tsx', 'aria.scroll_left'],
      ['components/explore/HorizontalScroll.tsx', 'aria.scroll_right'],
      ['components/stories/StoryHighlights.tsx', 'highlights.aria_edit'],
      ['components/stories/StoryHighlights.tsx', 'highlights.aria_delete'],
      ['pages/marketplace/EditMarketplaceListingPage.tsx', 'create.remove_image'],
      ['components/compose/MediaUploader.tsx', 'aria.drag_to_reorder'],
      ['components/compose/MediaUploader.tsx', 'compose.image_remove_number_aria'],
      ['components/compose/MediaUploader.tsx', 'compose.alt_text_edit'],
      ['components/feed/ConnectionSuggestionsWidget.tsx', 'suggestions.dismiss'],
      ['components/feed/StoriesBar.tsx', 'stories.scroll_left'],
      ['components/feed/StoriesBar.tsx', 'stories.scroll_right'],
      ['components/ideation/TeamChatrooms.tsx', 'chatrooms.unpin'],
      ['components/ideation/TeamChatrooms.tsx', 'comments.delete'],
      ['admin/modules/gamification/CustomBadges.tsx', 'gamification.delete_badge_aria'],
    ] as const;

    for (const [path, marker] of overlayTargets) {
      const controls = controlsContaining(path, marker);
      expect(controls.some(({ tag }) => tag === 'OverlayActionButton')).toBe(true);
    }
  });

  it('keeps StoryHighlights owner actions as siblings of the view button', () => {
    const source = parse('components/stories/StoryHighlights.tsx');
    const nested: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Button') {
        const inspectDescendant = (child: ts.Node) => {
          const opening = openingElement(child);
          const tag = opening?.tagName.getText(source);
          if (tag === 'Button' || tag === 'OverlayActionButton') {
            const { line } = source.getLineAndCharacterOfPosition(opening!.getStart(source));
            nested.push(`${tag}:${line + 1}`);
            return;
          }
          ts.forEachChild(child, inspectDescendant);
        };
        node.children.forEach(inspectDescendant);
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
    expect(nested).toEqual([]);
  });
});
