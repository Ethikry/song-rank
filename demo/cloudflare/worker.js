/**
 * ethikry.dev's front door.
 *
 * ethikry.dev/projects/<name>/… is handed, path unchanged, to that project's
 * own Worker through a service binding. Each project deploys separately (a
 * static-assets deploy replaces everything in its Worker), and each is built
 * with its /projects/<name>/ base path, so no rewriting is needed. Adding a
 * project is one line in PROJECTS plus a [[services]] entry in wrangler.toml.
 *
 * Anything else gets a bare placeholder, until the site has a home page —
 * which can be one more bound Worker.
 */
const PROJECTS = {
  'song-rank': 'SONG_RANK',
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const m = url.pathname.match(/^\/projects\/([^/]+)(\/.*)?$/)
    if (!m) return placeholder(url.pathname === '/' ? 200 : 404)
    const binding = PROJECTS[m[1]]
    if (!binding) return placeholder(404)

    // Relative asset URLs only resolve under the trailing slash.
    if (!m[2]) return Response.redirect(`${url.origin}/projects/${m[1]}/${url.search}`, 301)

    return env[binding].fetch(request)
  },
}

function placeholder(status) {
  const links = Object.keys(PROJECTS)
    .map((p) => `<li><a href="/projects/${p}/">${p}</a></li>`)
    .join('')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ethikry.dev</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#1e1b14;background:#f6f1e5}a{color:#b23a1c}
@media (prefers-color-scheme:dark){body{color:#e9e2cf;background:#232019}a{color:#e0785a}}</style></head>
<body><h1>ethikry.dev</h1>${status === 404 ? '<p>Nothing here.</p>' : ''}<p>Projects:</p><ul>${links}</ul></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
