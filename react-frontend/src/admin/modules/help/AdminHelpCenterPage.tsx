import { Card, CardBody, CardHeader, Button, Input, Chip } from '@/components/ui';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import BookOpen from 'lucide-react/icons/book-open';
import SearchIcon from 'lucide-react/icons/search';
import HelpCircle from 'lucide-react/icons/help-circle';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import { PageHeader } from '../../components/PageHeader';
import { getHelpContent, type HelpArticle } from '../../data/helpContent';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


// ─────────────────────────────────────────────────────────────────────────────
// Category detection
// ─────────────────────────────────────────────────────────────────────────────

type Category = 'Caring Community' | 'General Admin';

const CARING_PATHS = new Set([
  '/super-admin/national/kiss',
  '/admin/ki-agents',
  '/admin/pilot-inquiries',
]);

function getCategory(path: string): Category {
  if (path.startsWith('/caring/') || path === '/caring' || CARING_PATHS.has(path)) {
    return 'Caring Community';
  }
  return 'General Admin';
}

const CATEGORY_ORDER: Category[] = ['General Admin', 'Caring Community'];

const CATEGORY_CHIP_COLOR: Record<Category, 'default' | 'secondary'> = {
  'General Admin': 'default',
  'Caring Community': 'secondary',
};

function categoryKey(category: Category): string {
  switch (category) {
    case 'Caring Community':
      return 'admin_help.categories.caring_community';
    case 'General Admin':
    default:
      return 'admin_help.categories.general_admin';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminHelpCenterPage() {
  const { t } = useTranslation(['admin_help_module', 'admin_help']);
  const { t: tGuide } = useTranslation('help_centre');
  usePageTitle(t('admin_help.page_title'));
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const helpContent = useMemo(() => getHelpContent(t), [t]);

  // Filter + categorise in one pass
  const categorised = useMemo(() => {
    const q = query.toLowerCase().trim();

    const filtered = Object.entries(helpContent).filter(
      ([, article]: [string, HelpArticle]) =>
        !q ||
        article.title.toLowerCase().includes(q) ||
        article.summary.toLowerCase().includes(q),
    );

    const groups = new Map<Category, Array<[string, HelpArticle]>>();
    for (const entry of filtered) {
      const cat = getCategory(entry[0]);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(entry);
    }

    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      articles: groups.get(cat) ?? [],
    })).filter((g) => g.articles.length > 0);
  }, [helpContent, query]);

  const totalArticles = useMemo(
    () => Object.keys(helpContent).length,
    [helpContent],
  );

  const isEmpty = query.trim() && categorised.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin_help.title')}
        description={t('admin_help.description')}
      />

      {/* The full, plain-English admin guide lives in the Help Centre. */}
      <Card className="border border-accent/30 bg-accent/5">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <LifeBuoy size={22} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{tGuide('admin_panel.title')}</h2>
              <p className="text-sm text-muted">{tGuide('admin_panel.subtitle')}</p>
            </div>
          </div>
          <Button as={Link} to={tenantPath('/help/admins')} color="primary" size="sm" className="shrink-0">
            {tGuide('admin_panel.open_full')}
          </Button>
        </CardBody>
      </Card>

      {/* Search bar */}
      <div className="max-w-lg">
        <Input type="search" name="admin-search" autoComplete="off"
          placeholder={t('admin_help.search_placeholder', { count: totalArticles })}
          value={query}
          onValueChange={setQuery}
          startContent={<SearchIcon size={16} className="text-muted shrink-0" />}
          variant="secondary"
          size="md"
          aria-label={t('admin_help.search_aria')}
          isClearable
          onClear={() => setQuery('')}
        />
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted">
          <SearchIcon size={40} className="opacity-40" aria-hidden="true" />
          <p className="text-sm">{t('admin_help.no_matches')}</p>
        </div>
      )}

      {/* Categorised article grid */}
      {!isEmpty &&
        categorised.map(({ category, articles }) => (
          <section key={category}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">{t(categoryKey(category))}</h2>
              <Chip
                size="sm"
                variant="soft"
                color={CATEGORY_CHIP_COLOR[category]}
              >
                {articles.length}
              </Chip>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map(([path, article]) => (
                <Card
                  key={path}
                  isPressable
                  onPress={() => navigate(tenantPath(path))}
                  className="transition-shadow hover:shadow-md"
                >
                  <CardHeader className="flex items-start gap-2 pb-1">
                    <BookOpen size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                    <span className="text-sm font-semibold text-foreground leading-snug">
                      {article.title}
                    </span>
                  </CardHeader>
                  <CardBody className="flex flex-col gap-3 pt-0">
                    <p className="line-clamp-2 text-xs text-muted leading-relaxed">
                      {article.summary}
                    </p>
                    <Button
                      size="sm"
                      variant="tertiary"
                      className="self-start"
                      onPress={() => navigate(tenantPath(path))}
                      startContent={<HelpCircle size={14} />}
                    >
                      {t('admin_help.view_help')}
                    </Button>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
