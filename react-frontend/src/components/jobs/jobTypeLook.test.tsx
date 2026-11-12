// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The job type's look — the colour of its label and the picture on its tile —
 * is defined once, and both the jobs list's card and the job form's live
 * preview use it. Before this the preview painted the label in the type's
 * palette colour while the card used fixed chip colours ("Paid" green on the
 * list, teal in the preview), and the preview's tile always showed a
 * briefcase (audit of warmth phase 5, 12 Nov 2026).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Heart from 'lucide-react/icons/heart';
import Timer from 'lucide-react/icons/timer';
import Briefcase from 'lucide-react/icons/briefcase';
import { render, screen } from '@/test/test-utils';
import { Chip } from '@/components/ui/Chip';
import { JOB_TYPE_CHIP_COLOURS, jobTypeIcon } from './jobTypeLook';
import { JobPreviewCard, type JobPreviewCardProps } from './JobPreviewCard';

const base: JobPreviewCardProps = {
  title: '', description: '', type: 'paid', commitment: 'flexible', location: '', isRemote: false,
};

describe('the look of a job type', () => {
  it('keeps the meaning colours the jobs list has always used', () => {
    expect(JOB_TYPE_CHIP_COLOURS).toEqual({ paid: 'success', volunteer: 'default', timebank: 'accent' });
  });

  it('draws a picture per type, and a briefcase for anything else', () => {
    expect(jobTypeIcon('paid')).toBe(DollarSign);
    expect(jobTypeIcon('volunteer')).toBe(Heart);
    expect(jobTypeIcon('timebank')).toBe(Timer);
    expect(jobTypeIcon('something-new')).toBe(Briefcase);
    expect(jobTypeIcon('')).toBe(Briefcase);
  });

  it('gives the preview the same type label as the list\'s card', () => {
    for (const type of ['paid', 'volunteer', 'timebank'] as const) {
      const { unmount } = render(
        <>
          <JobPreviewCard {...base} type={type} />
          <Chip data-testid="reference" size="sm" variant="tertiary" color={JOB_TYPE_CHIP_COLOURS[type]} className="text-xs">
            x
          </Chip>
        </>,
      );
      expect(screen.getByTestId('job-preview-type').className, type).toBe(screen.getByTestId('reference').className);
      unmount();
    }
  });

  it('is what the jobs list itself uses, not a copy of it', () => {
    const page = readFileSync(join(__dirname, '../../pages/jobs/JobsPage.tsx'), 'utf8');
    expect(page).toContain("from '@/components/jobs/jobTypeLook'");
    expect(page).toContain('JOB_TYPE_CHIP_COLOURS[vacancy.type]');
    expect(page).toContain('jobTypeIcon(vacancy.type)');
    expect(page).not.toMatch(/const TYPE_CHIP_COLORS\b/);
  });
});
