import { describe, expect, it } from 'vitest'
import { detect, importFrom, routeFor, snippetFor } from '../src/cli/scaffold.js'

describe('working out what somebody has', () => {
  it('finds a Next.js app from its dependency', () => {
    const project = detect({ manifest: { dependencies: { next: '^15.0.0' } }, files: ['package.json', 'app'] })

    expect(project.framework).toBe('next')
    expect(project.route).toBe('app/api/chat/route.ts')
    expect(project.start).toBe('npm run dev')
  })

  it('puts the route under src when the project keeps its code there', () => {
    const project = detect({ manifest: { dependencies: { next: '^15.0.0' } }, files: ['package.json', 'src'] })
    expect(project.route).toBe('src/app/api/chat/route.ts')
  })

  it('finds a Worker from its config file, whatever the extension', () => {
    for (const config of ['wrangler.jsonc', 'wrangler.toml', 'wrangler.json']) {
      expect(detect({ files: ['package.json', config], manifest: {} }).framework).toBe('worker')
    }
  })

  it('falls back to a plain node server when there is a manifest and nothing else', () => {
    expect(detect({ manifest: { dependencies: { hono: '^4' } }, files: ['package.json'] }).framework).toBe('node')
  })

  it('writes nothing into a folder that is not a project', () => {
    const project = detect({ files: ['notes.txt'] })

    // Guessing here would put a file where nothing reads it, which looks
    // exactly like the tool having done nothing at all.
    expect(project.framework).toBe('unknown')
    expect(project.route).toBe('')
  })

  it('reads a dev dependency too, since that is where a framework often sits', () => {
    expect(detect({ manifest: { devDependencies: { wrangler: '^3' } }, files: [] }).framework).toBe('worker')
  })
})

describe('the import back to the index', () => {
  it('climbs out of a deep route', () => {
    // The bug this exists to stop: a route three folders down importing
    // './recourse/knowledge.json', which throws the first time it is run.
    expect(importFrom('app/api/chat/route.ts', 'recourse/knowledge.json')).toBe('../../../recourse/knowledge.json')
  })

  it('climbs one level from a Worker entry point', () => {
    expect(importFrom('src/index.ts', 'recourse/knowledge.json')).toBe('../recourse/knowledge.json')
  })

  it('stays local for a file at the root', () => {
    expect(importFrom('server.ts', 'recourse/knowledge.json')).toBe('./recourse/knowledge.json')
  })
})

describe('the file it writes', () => {
  it('gives Next.js both verbs, because the browser sends a preflight', () => {
    const project = detect({ manifest: { dependencies: { next: '^15' } }, files: ['app'] })
    const route = routeFor(project, 'recourse/knowledge.json')

    expect(route).toContain("from '@recourse-ai/core/server'")
    expect(route).toContain('export const POST')
    expect(route).toContain('export const OPTIONS')
    expect(route).toContain('../../../recourse/knowledge.json')
  })

  it('gives a Worker a fetch handler on the path the widget posts to', () => {
    const project = detect({ files: ['wrangler.jsonc'], manifest: {} })
    const route = routeFor(project, 'recourse/knowledge.json')

    expect(route).toContain('export default {')
    expect(route).toContain("'/api/chat'")
    // Built inside `fetch`, because a Worker gets its variables from the
    // request rather than from a global environment at module scope.
    expect(route).toContain('models.fromEnvironment(env)')
  })

  it('imports every generated route from a path that matches where it lands', () => {
    for (const found of [
      { manifest: { dependencies: { next: '^15' } }, files: ['app'] },
      { manifest: {}, files: ['wrangler.toml'] },
      { manifest: { dependencies: {} }, files: ['package.json'] },
    ]) {
      const project = detect(found)
      expect(routeFor(project, 'recourse/knowledge.json')).toContain(
        importFrom(project.route, 'recourse/knowledge.json'),
      )
    }
  })
})

describe('the snippet', () => {
  it('points at the endpoint the route was written for', () => {
    expect(snippetFor()).toContain('data-endpoint="/api/chat"')
    expect(snippetFor('/support')).toContain('data-endpoint="/support"')
  })

  it('loads the widget under its published name', () => {
    expect(snippetFor()).toContain('@recourse-ai/widget')
  })
})
