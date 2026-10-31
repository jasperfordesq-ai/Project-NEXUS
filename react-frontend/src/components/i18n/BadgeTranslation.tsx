// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useState } from 'react';
import { TranslateButton } from './TranslateButton';
import type { BadgeCopySource } from '@/hooks/useBadgeCopy';

/** Custom community copy uses the established UGC path; built-in copy uses catalogues. */
export function BadgeTranslation({ badge, id }: { badge: BadgeCopySource; id: string }) {
  const [body, setBody] = useState('');
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  return <div className="space-y-2">
    {fields?.name && <p dir="auto">{fields.name}</p>}
    {body && <p dir="auto">{body}</p>}
    <TranslateButton contentType="badge" contentId={id}
      sourceText={badge.description_code ? '' : badge.description || ''}
      extraFields={{ name: badge.name_code ? '' : badge.name }}
      onTextChange={(text, translated) => setBody(translated ? text : '')} onFieldsChange={setFields} />
  </div>;
}
