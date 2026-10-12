import { CardBody, Card, Button, Chip, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tenant Hierarchy
 * Visual tree view of parent-child tenant relationships.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import ChevronRight from 'lucide-react/icons/chevron-right';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronsDownUp from 'lucide-react/icons/chevrons-down-up';
import ChevronsUpDown from 'lucide-react/icons/chevrons-up-down';
import Building2 from 'lucide-react/icons/building-2';
import Users from 'lucide-react/icons/users';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Network from 'lucide-react/icons/network';
import Plus from 'lucide-react/icons/plus';
import List from 'lucide-react/icons/list';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { TenantHierarchyNode } from '../../api/types';

interface TreeNodeProps {
  node: TenantHierarchyNode;
  depth: number;
  onNavigate: (id: number) => void;
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
  t: (key: string) => string;
}

function TreeNode({ node, depth, onNavigate, expandedIds, onToggle, t }: TreeNodeProps) {
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-surface-secondary cursor-pointer transition-colors"
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        {hasChildren ? (
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={expanded ? t('common.collapse') : t('common.expand')}
            onPress={() => onToggle(node.id)}
            className="shrink-0"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </Button>
        ) : (
          <div className="w-8 shrink-0" />
        )}

        <div
          className="flex items-center gap-3 flex-1 min-w-0"
          onClick={() => onNavigate(node.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(node.id); } }}
        >
          <Building2 size={18} className="text-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-foreground">{node.name}</span>
            <span className="text-xs text-muted ml-2">({node.slug})</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-xs text-muted">
              <Users size={12} />
              {node.user_count}
            </span>
            <Chip
              size="sm"
              variant="soft"
              color={node.is_active ? 'success' : 'default'}
            >
              {node.is_active ? t('super.status_active_label') : t('super.status_inactive_label')}
            </Chip>
            {node.allows_subtenants && (
              <Chip size="sm" variant="soft">{t('super.hub')}</Chip>
            )}
          </div>
        </div>
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onNavigate={onNavigate}
              expandedIds={expandedIds}
              onToggle={onToggle}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TenantHierarchy() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.super_dashboard_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [hierarchy, setHierarchy] = useState<TenantHierarchyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const collectAllIds = useCallback((nodes: TenantHierarchyNode[]): number[] => {
    const ids: number[] = [];
    const walk = (list: TenantHierarchyNode[]) => {
      for (const n of list) {
        if (n.children && n.children.length > 0) {
          ids.push(n.id);
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return ids;
  }, []);

  const handleToggle = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(collectAllIds(hierarchy)));
  }, [hierarchy, collectAllIds]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const loadHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSuper.getHierarchy();
      if (res.success && res.data) {
        const data = Array.isArray(res.data) ? res.data : [];
        setHierarchy(data);
        // Auto-expand top-level nodes (depth < 2)
        const initialIds: number[] = [];
        for (const node of data) {
          if (node.children && node.children.length > 0) initialIds.push(node.id);
        }
        setExpandedIds(new Set(initialIds));
      }
    } catch {
      toast.error(t('super.failed_to_load_hierarchy'));
    }
    setLoading(false);
  }, [t, toast])


  useEffect(() => {
    loadHierarchy();
  }, [loadHierarchy]);

  const handleNavigate = (tenantId: number) => {
    navigate(tenantPath(`/super-admin/tenants/${tenantId}`));
  };

  return (
    <div>
      <nav aria-label={t('super.breadcrumb_nav_aria')} className="flex items-center gap-1 text-sm text-muted mb-1">
        <Link to={tenantPath('/super-admin')} className="hover:text-accent">{t('super.super_dashboard_title')}</Link>
        <span>/</span>
        <Link to={tenantPath('/super-admin/tenants')} className="hover:text-accent">{t('super.tenants')}</Link>
        <span>/</span>
        <span className="text-foreground">{t('super.hierarchy')}</span>
      </nav>
      <PageHeader
        title={t('super.tenant_hierarchy_title')}
        description={t('super.tenant_hierarchy_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              startContent={<ChevronsUpDown size={16} />}
              onPress={expandAll}
              size="sm"
            >
              {t('super.expand_all')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<ChevronsDownUp size={16} />}
              onPress={collapseAll}
              size="sm"
            >
              {t('super.collapse_all')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/super-admin/tenants')}
              variant="tertiary"
              startContent={<List size={16} />}
              size="sm"
            >
              {t('super.view_all_tenants')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/super-admin/tenants/create')}
              startContent={<Plus size={16} />}
              size="sm"
            >
              {t('super.create_tenant')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadHierarchy}
              isLoading={loading}
              size="sm"
            >
              {t('super.refresh')}
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      ) : hierarchy.length === 0 ? (
        <Card >
          <CardBody className="flex flex-col items-center py-12 text-muted">
            <Network size={40} className="mb-2" />
            <p>{t('super.no_hierarchy_data')}</p>
            <p className="text-xs">{t('super.no_hierarchy_data_desc')}</p>
          </CardBody>
        </Card>
      ) : (
        <Card >
          <CardBody className="p-4">
            {hierarchy.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                onNavigate={handleNavigate}
                expandedIds={expandedIds}
                onToggle={handleToggle}
                t={t}
              />
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export default TenantHierarchy;
