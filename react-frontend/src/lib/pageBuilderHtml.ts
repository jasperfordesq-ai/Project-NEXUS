// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import DOMPurify from 'dompurify';

const BUILDER_SCOPE = '.nexus-custom-page-builder';

const PAGE_BUILDER_BASELINE_CSS = `
.nexus-custom-page-builder{background:var(--background,#ffffff);color:var(--foreground,#111827);color-scheme:inherit}
.nexus-custom-page-builder a{color:var(--accent-color,var(--color-accent,#0891b2))}
.nexus-custom-page-builder img{max-width:100%;height:auto}
.nexus-custom-page-builder .nexus-page-uploaded-image,.nexus-custom-page-builder .nexus-page-section > img{display:block;max-width:100%;height:auto;border-radius:.75rem}
.nexus-custom-page-builder .nexus-page-uploaded-image + *,.nexus-custom-page-builder .nexus-page-section > img + .nexus-page-container{margin-top:clamp(1.5rem,3vw,2.5rem)}
`.trim();

const PAGE_BUILDER_THEME_OVERRIDE_CSS = `
.nexus-custom-page-builder .nexus-page-section{background:var(--background,#ffffff);color:var(--foreground,#111827)}
.nexus-custom-page-builder .nexus-page-section:nth-child(even){background:var(--surface-elevated,rgba(255,255,255,.9))}
.nexus-custom-page-builder .nexus-page-hero{background:linear-gradient(135deg,var(--surface-elevated,rgba(255,255,255,.9)) 0%,color-mix(in srgb,var(--accent-color,var(--color-accent,#0891b2)) 12%,var(--background,#ffffff)) 55%,color-mix(in srgb,var(--color-warning,#d97706) 10%,var(--background,#ffffff)) 100%)}
.nexus-custom-page-builder .nexus-page-kicker{color:var(--accent-color,var(--color-accent,#0891b2))}
.nexus-custom-page-builder .nexus-page-hero h1,.nexus-custom-page-builder .nexus-page-card h2{color:var(--foreground,#111827)}
.nexus-custom-page-builder .nexus-page-lede,.nexus-custom-page-builder .nexus-page-card p{color:var(--foreground-muted,var(--foreground,#4b5563))}
.nexus-custom-page-builder .nexus-page-card{background:var(--surface-elevated,rgba(255,255,255,.9));border-color:var(--border-default,rgba(17,24,39,.12));color:var(--foreground,#111827)}
.nexus-custom-page-builder .nexus-page-button{background:var(--accent-color,var(--color-accent,#0891b2));color:var(--accent-foreground,#ffffff)}
`.trim();

const LEGACY_NEXUS_PAGE_COLOR_VALUES = new Map<string, string>([
  ['#ffffff', 'var(--background,#ffffff)'],
  ['#f7faf8', 'var(--surface-elevated,rgba(255,255,255,.9))'],
  ['#f6fbf8', 'var(--surface-elevated,rgba(255,255,255,.9))'],
  ['#eef6ff', 'color-mix(in srgb,var(--accent-color,var(--color-accent,#0891b2)) 12%,var(--background,#ffffff))'],
  ['#fff7ed', 'color-mix(in srgb,var(--color-warning,#d97706) 10%,var(--background,#ffffff))'],
  ['#111827', 'var(--foreground,#111827)'],
  ['#10201a', 'var(--foreground,#111827)'],
  ['#40524a', 'var(--foreground-muted,var(--foreground,#4b5563))'],
  ['#4b5563', 'var(--foreground-muted,var(--foreground,#4b5563))'],
  ['#047857', 'var(--accent-color,var(--color-accent,#0891b2))'],
]);

const UNSAFE_CSS_PATTERNS = [
  /@import\b/i,
  /expression\s*\(/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:/i,
  /file\s*:/i,
  /behavior\s*:/i,
  /-moz-binding\s*:/i,
  /<\/style\b/i,
  /<\/script\b/i,
];

export const PAGE_BUILDER_ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'ins', 'del',
  'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  'form', 'label', 'input', 'textarea', 'select', 'option', 'button',
  // Kept only while an exported builder document is being normalised. Public
  // rendering extracts and scopes this CSS before sanitising the body again.
  'style',
];

export const PAGE_BUILDER_ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id',
  'colspan', 'rowspan', 'scope',
  'width', 'height', 'loading',
  'target', 'rel', 'style',
  'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'type', 'name', 'value', 'placeholder', 'checked', 'selected', 'disabled',
  'required', 'for', 'action', 'method',
];

const URL_BEARING_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'xlink:href'] as const;
const FORM_TARGET_ATTRIBUTES = new Set<string>(['action', 'formaction']);

const GLOBAL_SELECTOR_PARTS = [
  ':root',
  'html',
  'body',
  'head',
  'script',
  'style',
  '#root',
  '#app',
];

type CssDeclaration = {
  prop: string;
  value: string;
  important: boolean;
};

type CssRule = {
  type: 'rule';
  selector: string;
  declarations: CssDeclaration[];
};

type CssAtRule = {
  type: 'atrule';
  name: string;
  params: string;
  nodes: CssNode[];
};

type CssNode = CssRule | CssAtRule;

function isUnsafeCss(css: string): boolean {
  return UNSAFE_CSS_PATTERNS.some((pattern) => pattern.test(css));
}

/** Remove CSS comments without treating comment markers inside strings as syntax. */
function stripCssComments(css: string): string {
  let output = '';
  let index = 0;
  let quote: '"' | "'" | null = null;

  while (index < css.length) {
    const char = css[index] ?? '';
    const next = css[index + 1] ?? '';

    if (quote) {
      output += char;
      if (char === '\\' && index + 1 < css.length) {
        output += next;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = css.indexOf('*/', index + 2);
      if (end === -1) break;
      index = end + 2;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function splitSelectorList(selectors: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const char of selectors) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isGlobalSelector(selector: string): boolean {
  const lowered = selector.trim().toLowerCase();
  return GLOBAL_SELECTOR_PARTS.some((part) => lowered === part || lowered.startsWith(`${part}.`) || lowered.startsWith(`${part} `));
}

function scopeSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.startsWith('@') || isGlobalSelector(trimmed)) return null;
  if (trimmed.startsWith(BUILDER_SCOPE)) return trimmed;
  return `${BUILDER_SCOPE} ${trimmed}`;
}

function normalizeCssValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*!important\s*$/i, '')
    .trim();
}

function isZeroCssValue(value: string): boolean {
  const normalized = normalizeCssValue(value).toLowerCase();
  return normalized.split(/\s+/).every((part) => ['0', '0px', '0rem', '0em', '0%'].includes(part));
}

function isSafeCssDeclaration(property: string, value: string): boolean {
  const normalizedProperty = property.trim().toLowerCase();
  const normalizedValue = normalizeCssValue(value);

  if (!normalizedProperty || !normalizedValue) return false;
  // CSS escapes can disguise blocked property names, functions, and schemes.
  // GrapesJS emits ordinary CSS identifiers, so reject escaped declarations
  // instead of trying to implement the browser's full CSS escape decoder here.
  if (normalizedProperty.includes('\\') || normalizedValue.includes('\\')) return false;
  if (!/^(?:--[a-z0-9_-]+|[a-z][a-z0-9-]*)$/i.test(normalizedProperty)) return false;
  if (isUnsafeCss(`${normalizedProperty}:${normalizedValue}`)) return false;
  if (normalizedProperty === 'position' && ['fixed', 'sticky'].includes(normalizedValue)) return false;
  if (normalizedProperty === 'z-index') return false;
  if (normalizedProperty === 'inset' && isZeroCssValue(value)) return false;
  return true;
}

function shouldTokenizeLegacyNexusRule(rule: CssRule): boolean {
  return splitSelectorList(rule.selector).some((selector) => selector.includes('nexus-page-'));
}

function tokenizeLegacyNexusPageValue(property: string, value: string, shouldTokenize: boolean): string {
  if (!shouldTokenize) return value;

  const normalizedProperty = property.trim().toLowerCase();
  if (!['background', 'background-color', 'border-color', 'box-shadow', 'color'].includes(normalizedProperty)) {
    return value;
  }

  let next = value;
  if (normalizedProperty === 'color') {
    next = next.replace(/#fff(?:fff)?\b/gi, 'var(--accent-foreground,#fff)');
  } else {
    next = next.replace(/#fff(?:fff)?\b/gi, 'var(--background,#ffffff)');
  }
  for (const [legacyValue, tokenValue] of LEGACY_NEXUS_PAGE_COLOR_VALUES) {
    next = next.replace(new RegExp(legacyValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), tokenValue);
  }
  return next;
}

function splitCssList(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if (char === delimiter && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function findTopLevelColon(value: string): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if (char === ':' && depth === 0) return i;
  }

  return -1;
}

function parseDeclarations(css: string): CssDeclaration[] {
  return splitCssList(css, ';')
    .map((part) => {
      const colonIndex = findTopLevelColon(part);
      if (colonIndex <= 0) return null;
      const prop = part.slice(0, colonIndex).trim();
      let value = part.slice(colonIndex + 1).trim();
      const important = /\s*!important\s*$/i.test(value);
      value = value.replace(/\s*!important\s*$/i, '').trim();
      if (!prop || !value) return null;
      return { prop, value, important };
    })
    .filter((declaration): declaration is CssDeclaration => Boolean(declaration));
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < css.length; i += 1) {
    const char = css[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function parseCssNodes(css: string): CssNode[] {
  const nodes: CssNode[] = [];
  let index = 0;

  while (index < css.length) {
    const openIndex = css.indexOf('{', index);
    if (openIndex === -1) break;

    const prelude = css.slice(index, openIndex).trim();
    const closeIndex = findMatchingBrace(css, openIndex);
    if (!prelude || closeIndex === -1) break;

    const body = css.slice(openIndex + 1, closeIndex);
    if (prelude.startsWith('@')) {
      const [, name = '', params = ''] = prelude.match(/^@([\w-]+)\s*([\s\S]*)$/) ?? [];
      nodes.push({
        type: 'atrule',
        name: name.toLowerCase(),
        params: params.trim(),
        nodes: parseCssNodes(body),
      });
    } else {
      nodes.push({
        type: 'rule',
        selector: prelude,
        declarations: parseDeclarations(body),
      });
    }

    index = closeIndex + 1;
  }

  return nodes;
}

function serializeSafeDeclarations(rule: CssRule, tokenizeLegacyValues = true): string {
  const declarations: string[] = [];
  const shouldTokenize = tokenizeLegacyValues && shouldTokenizeLegacyNexusRule(rule);

  rule.declarations.forEach((declaration) => {
    if (!isSafeCssDeclaration(declaration.prop, declaration.value)) return;
    const value = tokenizeLegacyNexusPageValue(declaration.prop, declaration.value, shouldTokenize);
    declarations.push(`${declaration.prop}:${value}${declaration.important ? ' !important' : ''}`);
  });

  return declarations.join(';');
}

function scopeCssContainer(nodes: CssNode[]): string {
  const output: string[] = [];

  nodes.forEach((node) => {
    if (node.type === 'rule') {
      const scopedSelectors = splitSelectorList(node.selector)
        .map(scopeSelector)
        .filter((selector): selector is string => Boolean(selector));
      const safeBody = serializeSafeDeclarations(node);

      if (scopedSelectors.length > 0 && safeBody) {
        output.push(`${scopedSelectors.join(',')}{${safeBody}}`);
      }
      return;
    }

    if (node.type === 'atrule') {
      const atRuleName = node.name.toLowerCase();
      if (!['media', 'supports'].includes(atRuleName)) return;

      const nested = scopeCssContainer(node.nodes);
      if (nested) output.push(`@${atRuleName} ${node.params}{${nested}}`);
    }
  });

  return output.join('\n');
}

function sanitizeCssContainerForStorage(nodes: CssNode[]): string {
  const output: string[] = [];

  nodes.forEach((node) => {
    if (node.type === 'rule') {
      const safeSelectors = splitSelectorList(node.selector)
        .map((selector) => selector.trim())
        .filter((selector) => selector && !selector.startsWith('@') && !isGlobalSelector(selector));
      const safeBody = serializeSafeDeclarations(node, false);

      if (safeSelectors.length > 0 && safeBody) {
        output.push(`${safeSelectors.join(',')}{${safeBody}}`);
      }
      return;
    }

    const atRuleName = node.name.toLowerCase();
    if (!['media', 'supports'].includes(atRuleName) || !node.params) return;

    const nested = sanitizeCssContainerForStorage(node.nodes);
    if (nested) output.push(`@${atRuleName} ${node.params}{${nested}}`);
  });

  return output.join('\n');
}

/**
 * Sanitize GrapesJS CSS before embedding it in a stored <style> element.
 * Selectors remain unscoped so the stylesheet still works inside the editor;
 * public rendering applies the NEXUS wrapper scope separately.
 */
export function sanitizePageBuilderCssForStorage(css: string | null | undefined): string {
  if (!css) return '';
  const withoutComments = stripCssComments(css);
  // These tokens can escape the style container or fetch CSS before the rule
  // parser has a chance to inspect declarations, so reject the whole sheet.
  const lowered = withoutComments.toLowerCase();
  if (lowered.includes('@import') || lowered.includes('</style') || lowered.includes('</script')) return '';
  try {
    return sanitizeCssContainerForStorage(parseCssNodes(withoutComments)).trim();
  } catch {
    return '';
  }
}

export function scopePageBuilderCss(css: string | null | undefined): string {
  if (!css) return '';
  const withoutComments = stripCssComments(css);
  if (isUnsafeCss(withoutComments)) return '';
  try {
    return scopeCssContainer(parseCssNodes(withoutComments)).trim();
  } catch {
    return '';
  }
}

export function sanitizePageBuilderInlineStyle(style: string | null | undefined): string {
  if (!style) return '';
  const withoutComments = stripCssComments(style);
  try {
    return serializeSafeDeclarations({
      type: 'rule',
      selector: '.x',
      declarations: parseDeclarations(withoutComments),
    });
  } catch {
    return '';
  }
}

function isSafePageBuilderUrl(value: string, attribute: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  try {
    const parsed = new URL(candidate, document.baseURI || window.location.origin);
    if (FORM_TARGET_ATTRIBUTES.has(attribute)) {
      // F-282: where a form SENDS what visitors type is restricted to this
      // site. An outside address would let a published page collect passwords
      // for another origin from the community's own trusted domain. The
      // platform API is excluded too: a page form has no business posting to it.
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.origin === window.location.origin
        && !/^\/api(?:\/|$)/i.test(parsed.pathname);
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
    return attribute === 'href' && parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function sanitizePageBuilderFragment(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: PAGE_BUILDER_ALLOWED_TAGS,
    ALLOWED_ATTR: PAGE_BUILDER_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: true,
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  });

  fragment.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const safeStyle = sanitizePageBuilderInlineStyle(element.getAttribute('style'));
    if (safeStyle) element.setAttribute('style', safeStyle);
    else element.removeAttribute('style');
  });

  fragment.querySelectorAll<HTMLElement>('*').forEach((element) => {
    URL_BEARING_ATTRIBUTES.forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      if (!isSafePageBuilderUrl(element.getAttribute(attribute) ?? '', attribute)) {
        element.removeAttribute(attribute);
      }
    });
  });

  fragment.querySelectorAll('style').forEach((style) => {
    const safeCss = sanitizePageBuilderCssForStorage(style.textContent);
    if (safeCss) style.textContent = safeCss;
    else style.remove();
  });

  return fragment;
}

function serializePageBuilderFragment(fragment: DocumentFragment): string {
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML.trim();
}

export interface SanitizedPageBuilderDocument {
  bodyHtml: string;
  css: string;
}

/** Return separately sanitized builder HTML and unscoped CSS for safe storage or editing. */
export function sanitizePageBuilderDocument(html: string | null | undefined): SanitizedPageBuilderDocument {
  if (!html) return { bodyHtml: '', css: '' };

  const fragment = sanitizePageBuilderFragment(html);
  const css = Array.from(fragment.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .filter(Boolean)
    .join('\n');
  fragment.querySelectorAll('style').forEach((style) => style.remove());

  return { bodyHtml: serializePageBuilderFragment(fragment), css };
}

/**
 * Sanitize an exported GrapesJS HTML fragment before it is stored or reparsed.
 *
 * This function deliberately uses DOMPurify's parser-backed DOM output. Regex
 * tag filters can be bypassed by malformed or nested markup and are not a
 * security boundary. CSS and URLs receive their own policy before serialization.
 */
export function stripUnsafePageBuilderHtml(html: string): string {
  const { bodyHtml, css } = sanitizePageBuilderDocument(html);
  return `${css ? `<style>${css}</style>` : ''}${bodyHtml}`;
}

export function scopePageBuilderHtml(html: string | null | undefined): string {
  if (!html) return '';
  const { bodyHtml, css: unscopedCss } = sanitizePageBuilderDocument(html);
  const scopedCss = scopePageBuilderCss(unscopedCss);
  const css = [PAGE_BUILDER_BASELINE_CSS, scopedCss, PAGE_BUILDER_THEME_OVERRIDE_CSS].filter(Boolean).join('\n');
  return `${css ? `<style>${css}</style>` : ''}<div class="nexus-custom-page-builder">${bodyHtml}</div>`;
}

export function exportScopedPageBuilderHtml(bodyHtml: string, css: string): string {
  return scopePageBuilderHtml(`<style>${css}</style>${bodyHtml}`);
}

export const __pageBuilderHtmlTesting = {
  BUILDER_SCOPE,
  PAGE_BUILDER_BASELINE_CSS,
  PAGE_BUILDER_THEME_OVERRIDE_CSS,
  isSafeCssDeclaration,
  scopeSelector,
  tokenizeLegacyNexusPageValue,
};
