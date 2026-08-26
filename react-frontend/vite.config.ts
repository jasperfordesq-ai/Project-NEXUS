// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'
import { execSync } from 'child_process'
import { createRequire } from 'module'

// Inject git commit SHA at build time for version verification.
// In Docker production builds, BUILD_COMMIT is passed as a build arg (since
// .dockerignore excludes .git/). Falls back to git for local dev.
const commitHash = process.env.BUILD_COMMIT || (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
})()

const usePolling = process.env.VITE_USE_POLLING === '1' || process.env.CHOKIDAR_USEPOLLING === 'true'
const require = createRequire(import.meta.url)
const canOptimizeImages = (() => {
  try {
    require.resolve('sharp')
    return true
  } catch {
    return false
  }
})()

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = process.env.VITE_API_URL || env.VITE_API_URL || 'http://localhost:8090'
  const analyzeBundle = process.env.VITE_BUNDLE_ANALYZE === '1' || env.VITE_BUNDLE_ANALYZE === '1'

  return {
  cacheDir: path.resolve(__dirname, 'node_modules/.vite'),
  plugins: [
    react(),
    tailwindcss(),
    // Emit /build-info.json into the dist root at build time. Kept as a
    // simple ops-debugging endpoint — `curl https://app.project-nexus.ie/build-info.json`
    // reports the deployed commit. Excluded from precache (no .json in
    // globPatterns) and served with no-cache by nginx. No frontend code
    // consumes it anymore — the api.ts stale-client gate uses the X-Build
    // response header instead.
    {
      name: 'nexus:build-info',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify({ commit: commitHash }),
        });
      },
    },
    // VitePWA is always loaded so its virtual module (virtual:pwa-register) is
    // resolvable in dev. The plugin is disabled in dev via the `disable` flag —
    // no service worker is generated or registered, so there is zero SW overhead.
    VitePWA({
      disable: command !== 'build',
      registerType: 'prompt',
      // Don't inject SW registration into index.html automatically —
      // we handle it in main.tsx so it only fires in production builds
      injectRegister: null,
      manifest: false, // We use our own public/manifest.json
      workbox: {
        // Import our custom push event handler into the generated SW. The file
        // lives in /public, ships to the build root, and is resolvable at the
        // SW scope (/sw-push-handler.js). Adding push/notificationclick
        // listeners to the workbox-generated SW is otherwise impossible
        // without switching to InjectManifest.
        importScripts: ['/sw-push-handler.js'],
        // PRECACHE: the HTML fallback, content-hashed startup graph, and install
        // metadata. Navigations still use NetworkFirst, so online users receive
        // the current shell. The precached index is consulted only when both the
        // network and runtime HTML cache miss (the clean-install offline case).
        // The entry module, its HTML modulepreloads, and its stylesheet must be
        // available after a clean install even though their first request may
        // precede service-worker control. Route/editor chunks remain lazy.
        globPatterns: [
          'index.html',
          'assets/app-*.js',
          'assets/index-*.css',
          'assets/vendor-react-*.js',
          'assets/vendor-i18n-*.js',
          'sw-push-handler.js',
          'manifest.json',
          'favicon.svg',
          'og-default.svg',
          'icons/*.png',
        ],
        // Do not make first-visit SW install compete with login/register by
        // precaching heavyweight route-only bundles. These remain immutable
        // hashed assets and are fetched when their route/editor is opened.
        globIgnores: [
          '**/NewsletterBuilder-*.js',
          '**/AssetLibraryModal-*.js',
          '**/AssetLibraryModal-*.css',
          '**/HtmlSourceEditor-*.js',
          '**/OpenStreetMapView-*.js',
          '**/OpenStreetMapView-*.css',
          '**/jspdf*.js',
          '**/html2canvas*.js',
          '**/LexicalOnChangePlugin*.js',
          '**/vendor-charts-*.js',
          '**/MarkdownRenderer-*.js',
          '**/PageDesignBuilder-*.js',
          '**/CaringCommunityWorkflowPage-*.js',
          '**/helpContent-*.js',
          '**/images/*.png',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // Route chunks are content-hashed and immutable. Cache every chunk
          // actually used by a controlled page so a clean install can restart
          // its current route offline without precaching heavyweight editors.
          {
            urlPattern: ({ url }) => (
              url.origin === self.location.origin
              && /^\/assets\/[^/]+\.(?:js|css)$/.test(url.pathname)
            ),
            handler: 'CacheFirst',
            options: {
              cacheName: 'nexus-immutable-assets-v1',
              expiration: { maxEntries: 500, maxAgeSeconds: 365 * 86400 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // The SPA cannot render even its public/login shell until tenant
          // bootstrap resolves. Cache each slug-qualified successful response
          // so a previously installed tenant can restart offline; NetworkFirst
          // keeps online identity/settings current and never caches failures.
          {
            urlPattern: ({ request, url }) => (
              request.method === 'GET'
              && url.origin === self.location.origin
              && url.pathname.toLowerCase().replace(/\/+$/, '') === '/api/v2/tenant/bootstrap'
            ),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nexus-tenant-bootstrap-v1',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 32, maxAgeSeconds: 7 * 86400 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Published blog reads use an account-free public projection, so
          // articles remain fast and available to visitors and search engines.
          // The narrow matcher excludes comment, reaction, and mutation URLs.
          {
            urlPattern: ({ request, url }) => {
              if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
              const pathname = url.pathname.toLowerCase().replace(/\/+$/, '');
              return /^\/api\/v2\/blog(?:\/[^/]+)?$/.test(pathname);
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nexus-public-blog-api-v1',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 128, maxAgeSeconds: 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Private API data must never survive logout in a service-worker
          // cache. Only tenant bootstrap and sanitized blog reads are public.
          {
            urlPattern: ({ request, url }) => {
              if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
              const pathname = url.pathname.toLowerCase();
              const isApiPath = pathname === '/api' || pathname.startsWith('/api/');
              const isPublicBootstrap = pathname.replace(/\/+$/, '') === '/api/v2/tenant/bootstrap';
              const isPublicBlogRead = /^\/api\/v2\/blog(?:\/[^/]+)?$/.test(pathname.replace(/\/+$/, ''));
              return isApiPath && !isPublicBootstrap && !isPublicBlogRead;
            },
            handler: 'NetworkOnly',
            options: {
              fetchOptions: { cache: 'no-store', credentials: 'same-origin' },
            },
          },
          // Protected, auth/token, CMS, tenant-root, and unknown navigations
          // are deliberately network-only. This prevents identity-bearing
          // HTML or structured metadata from being replayed after logout.
          {
            urlPattern: ({ request, url }) => {
              if (request.mode !== 'navigate' || url.origin !== self.location.origin) return false;
              const pathname = url.pathname.toLowerCase().split('/').filter(Boolean).join('/');
              const isCacheablePublicPath = /^(?:|features|changelog|development-status|about|faq|contact|pilot-inquiry|pilot-apply|help|terms|privacy|accessibility|cookies|community-guidelines|trust-and-safety|account-deletion|child-safety|acceptable-use|legal|timebanking-guide|regional-analytics|partner|social-prescribing|impact-summary|impact-report|strategic-plan|pricing|blog(?:\/[^/]+)?|(?:terms|privacy|accessibility|cookies|community-guidelines|acceptable-use)\/versions|platform\/(?:terms|privacy|disclaimer)|developers(?:\/(?:auth|endpoints|webhooks))?)$/.test(pathname);
              return !isCacheablePublicPath;
            },
            handler: 'NetworkOnly',
            options: {
              fetchOptions: { cache: 'no-store', credentials: 'same-origin' },
            },
          },
          // Identity-free public HTML shell only. Online requests get the
          // freshly deployed shell; slow/offline requests may use this cache.
          // API, health, recovery, authenticated, token, CMS, tenant-prefixed,
          // and unknown URLs never reach this handler.
          {
            urlPattern: ({ request, url }) => {
              if (request.mode !== 'navigate') return false;
              if (url.origin !== self.location.origin) return false;
              const p = url.pathname;
              if (p.startsWith('/api/')) return false;
              if (p === '/health.php') return false;
              // /api/sw-reset is the emergency recovery URL — must always
              // hit the network so the web server can return Clear-Site-Data + the
              // inline unregister script.
              if (p === '/api/sw-reset') return false;
              const pathname = p.toLowerCase().split('/').filter(Boolean).join('/');
              return /^(?:|features|changelog|development-status|about|faq|contact|pilot-inquiry|pilot-apply|help|terms|privacy|accessibility|cookies|community-guidelines|trust-and-safety|account-deletion|child-safety|acceptable-use|legal|timebanking-guide|regional-analytics|partner|social-prescribing|impact-summary|impact-report|strategic-plan|pricing|blog(?:\/[^/]+)?|(?:terms|privacy|accessibility|cookies|community-guidelines|acceptable-use)\/versions|platform\/(?:terms|privacy|disclaimer)|developers(?:\/(?:auth|endpoints|webhooks))?)$/.test(pathname);
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nexus-public-html-shell-v3',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 16, maxAgeSeconds: 7 * 86400 },
              matchOptions: { ignoreSearch: true },
              // 200 only — status 0 (opaque cross-origin no-cors) responses
              // shouldn't be cached as the HTML shell. Our HTML is same-origin
              // so this would never hit, but tightening eliminates the footgun.
              cacheableResponse: {
                statuses: [200],
                headers: { 'X-Nexus-Spa-Shell': '1' },
              },
              // A newly installed worker did not control the navigation that
              // loaded it, so the runtime cache can still be empty. Fall back
              // to the revisioned precache shell for the first offline restart.
              precacheFallback: { fallbackURL: 'index.html' },
            },
          },
          {
            urlPattern: /^https?.*\/locales\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'nexus-locales',
              expiration: { maxEntries: 250, maxAgeSeconds: 30 * 86400 },
            },
          },
        ],
        // Explicitly disable the default NavigationRoute. vite-plugin-pwa
        // defaults navigateFallback to 'index.html', which registers a
        // precache-first NavigationRoute BEFORE the runtimeCaching rules,
        // so it would intercept every navigation and serve the stale shell
        // before the NetworkFirst handler above could see the request.
        // Setting navigateFallback to null disables this default and lets
        // the urlPattern callback above own all navigation routing.
        navigateFallback: null,
      },
    }),
    // Image optimizer only runs during build — skip in dev for faster startup.
    // Some local environments end up with an incomplete sharp install, which
    // makes vite-plugin-image-optimizer log asset errors despite a successful build.
    ...(command === 'build' && canOptimizeImages ? [ViteImageOptimizer({
      png: { quality: 80 },
      jpeg: { quality: 80 },
      jpg: { quality: 80 },
      webp: { lossless: false, quality: 80 },
      svg: { plugins: [{ name: 'preset-default' }] },
      logStats: true,
    })] : []),
    ...(command === 'build' && !canOptimizeImages ? [{
      name: 'nexus:missing-sharp-warning',
      configResolved() {
        console.warn('[vite] Skipping image optimization because sharp is not resolvable in this workspace.')
      },
    }] : []),
    ...(command === 'build' && analyzeBundle ? [visualizer({
      filename: 'dist/bundle-stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    })] : []),
  ],
  define: {
    __BUILD_COMMIT__: JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // lucide-react v0.453.0 has no package exports map, so sub-path imports
      // like `lucide-react/icons/lock` don't resolve. Map them to the actual
      // ESM dist files. Each file exports the icon as default, matching usage.
      {
        find: /^lucide-react\/icons\/(.+)$/,
        replacement: path.resolve(__dirname, 'node_modules/lucide-react/dist/esm/icons/$1.js'),
      },
    ],
  },
  optimizeDeps: {
    // Pre-bundle heavy deps so Vite doesn't re-crawl them on every page load.
    // lucide-react imports use individual sub-path files. Keep the Listings-only
    // icons that Vite has trouble optimizing on Windows as direct ESM source
    // imports; the optimized-deps layer returns 504 "Outdated Optimize Dep".
    exclude: [
      'lucide-react/icons/arrow-up-down',
      'lucide-react/icons/monitor',
      'lucide-react/icons/sliders-horizontal',
    ],
    include: [
      '@heroui/react',
      'react',
      'react-dom',
      'react-router-dom',
      'recharts',
      'i18next',
      'react-i18next',
    ],
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // Required for Docker
    // Do not enable Vite warmup here. This app's root graph is large, and
    // warming it made Vite report "ready" while still spending 10s+ transforming
    // modules, which caused audit/browser navigations to time out.
    watch: {
      // Polling over Docker Desktop's Windows bind mount pegged the Vite
      // container at high idle CPU and made even static file requests take
      // seconds. Keep it opt-in for machines that truly need it for HMR.
      usePolling,
      interval: 1000,
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/.codex_tmp/**',
        '**/*.log',
      ],
    },
    proxy: {
      // Proxy API requests to PHP backend
      // Uses Docker service name 'app' when running in Docker, localhost:8090 otherwise
      '/api': {
        target: apiUrl,
        changeOrigin: true,
        secure: false,
        timeout: 120000,
        proxyTimeout: 120000,
        configure: (proxy) => {
          proxy.on('error', (err) => { console.error('[vite-proxy] error:', err.message); });
        },
        headers: {
          // Ensure headers are forwarded
          'X-Forwarded-Proto': 'http',
        },
      },
      // Proxy uploaded assets (images, media) to PHP backend
      '/uploads': {
        target: apiUrl,
        changeOrigin: true,
      },
      '/storage': {
        target: apiUrl,
        changeOrigin: true,
      },
      // Proxy health check
      '/health.php': {
        target: apiUrl,
        changeOrigin: true,
      },
    },
  },
  // `vite preview` static server (npm run preview) — serves the built dist on
  // 4173 with the same API proxy as dev. No HMR / dep-optimizer / self-reload,
  // so it stays responsive under heavy machine load when the dev server on
  // 5173 is being starved of CPU/RAM.
  preview: {
    port: 4173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: apiUrl,
        changeOrigin: true,
        secure: false,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/uploads': { target: apiUrl, changeOrigin: true },
      '/storage': { target: apiUrl, changeOrigin: true },
      '/health.php': { target: apiUrl, changeOrigin: true },
    },
  },
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType !== 'html') {
          return deps
        }

        // HeroUI v3 is the platform UI contract and depends on React Aria.
        // Keep those components in the app, but do not eagerly advertise the
        // React Aria vendor chunk from the raw HTML shell.
        return deps.filter((dep) => !/vendor-(?:heroui|react-aria)-/.test(dep))
      },
    },
    outDir: 'dist',
    rollupOptions: {
      // Capacitor packages are optional native deps — not installed in web builds.
      // Guard all usages with window.Capacitor?.isNativePlatform?.() checks.
      external: ['@capacitor/app', '@capacitor/push-notifications'],
      output: {
        // A stable prefix lets Workbox select only the HTML entry instead of
        // every dynamic chunk whose Rollup name happens to be `index`.
        entryFileNames: 'assets/app-[hash].js',
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          const normalizedId = id.replace(/\\/g, '/');
          if (
            /\/node_modules\/(react|react-dom|react-router-dom|scheduler)\//.test(normalizedId) ||
            normalizedId.includes('/node_modules/react/jsx-runtime')
          ) {
            return 'vendor-react';
          }
          if (/\/node_modules\/(@react-aria|@react-stately|@react-types|@internationalized)\//.test(normalizedId)) {
            return 'vendor-react-aria';
          }
          if (/\/node_modules\/(i18next|react-i18next)\//.test(normalizedId)) {
            return 'vendor-i18n';
          }
          if (/\/node_modules\/recharts\//.test(normalizedId)) {
            return 'vendor-charts';
          }
          if (/\/node_modules\/(grapesjs|grapesjs-mjml|grapesjs-blocks-basic|grapesjs-custom-code|grapesjs-plugin-forms|grapesjs-preset-webpage|grapesjs-tabs|grapesjs-tooltip)\//.test(normalizedId)) {
            return 'vendor-grapesjs';
          }
          if (/\/node_modules\/(@codemirror|@uiw\/react-codemirror|codemirror|style-mod|w3c-keyname|crelt)\//.test(normalizedId)) {
            return 'vendor-codemirror';
          }
        },
      },
    },
  },
  }
})
