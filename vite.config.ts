import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Everything the site knows about its subject — the year CSVs, portraits, the
// branch map, titles — is read through `@data`. The real site points it at
// data/; `--mode demo` points it at demo/data/, the anonymized public copy
// (see demo/README.md). Swapping the alias rather than branching in code means
// the real CSVs are never even in the demo's module graph, so they cannot leak
// into its bundle through a missed condition.
const DEMO_BASE = '/projects/song-rank/'

/** index.html's <title> comes from the data root's site.json, like every other name on the page. */
function siteTitle(dataDir: string): Plugin {
  const site = JSON.parse(readFileSync(`${dataDir}/site.json`, 'utf8')) as { documentTitle: string }
  return {
    name: 'site-title',
    transformIndexHtml: (html) => html.replace('%SITE_TITLE%', site.documentTitle),
  }
}

// The auth service runs separately in dev (see server/README.md). Proxying
// /auth keeps it same-origin, which matters beyond convenience: the recap PNG
// export draws images onto a canvas, and a cross-origin avatar would taint it.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  const dataDir = fileURLToPath(new URL(demo ? './demo/data' : './data', import.meta.url))
  return {
    plugins: [react(), siteTitle(dataDir)],
    base: demo ? DEMO_BASE : '/',
    resolve: {
      alias: {
        '@data': dataDir,
      },
    },
    build: demo ? { outDir: `dist-demo${DEMO_BASE}`, emptyOutDir: true } : {},
    server: demo
      ? {}
      : {
          proxy: {
            '/auth': {
              target: process.env.AUTH_ORIGIN ?? 'http://127.0.0.1:8787',
              changeOrigin: true,
            },
          },
        },
  }
})