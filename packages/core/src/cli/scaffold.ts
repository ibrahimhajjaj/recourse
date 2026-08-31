/**
 * Working out what somebody has, and what to write into it.
 *
 * Split from the command itself so it can be tested without a terminal. The
 * command does the asking and the writing; everything here is a pure function
 * from "what is in this folder" to "what the file should say", which is the
 * half that is easy to get quietly wrong.
 */

/** The shapes worth writing a route for. */
export type Framework = 'next' | 'worker' | 'node' | 'unknown'

export interface Project {
  framework: Framework
  /** Where the route belongs, relative to the project root. */
  route: string
  /** What to tell the person to run afterwards. */
  start: string
}

export interface Detected {
  /** Contents of package.json, when there is one. */
  manifest?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined
  /** Names of files in the project root. */
  files: string[]
}

/**
 * What kind of project this is.
 *
 * Deliberately conservative. Guessing wrong writes a file into a place the
 * framework does not read, which looks like the tool silently doing nothing,
 * so anything unrecognised is `unknown` and gets printed rather than written.
 */
export function detect(found: Detected): Project {
  const deps = { ...(found.manifest?.dependencies ?? {}), ...(found.manifest?.devDependencies ?? {}) }
  const has = (name: string) => Object.hasOwn(deps, name)

  if (has('next')) {
    return {
      framework: 'next',
      // App Router. A project still on `pages/` gets told rather than guessed
      // at, because the two want different handler shapes.
      route: found.files.includes('src') ? 'src/app/api/chat/route.ts' : 'app/api/chat/route.ts',
      start: 'npm run dev',
    }
  }

  if (found.files.some((name) => name.startsWith('wrangler.')) || has('wrangler')) {
    return { framework: 'worker', route: 'src/index.ts', start: 'npx wrangler dev' }
  }

  if (found.manifest) {
    return { framework: 'node', route: 'server.ts', start: 'node --experimental-strip-types server.ts' }
  }

  return { framework: 'unknown', route: '', start: '' }
}

/**
 * The route file, for whichever shape was found.
 *
 * Each one imports the index from the path `ingest` actually wrote, so the
 * file works the moment it lands rather than after somebody fixes an import.
 */
export function routeFor(project: Project, indexPath: string): string {
  const { framework } = project
  // Computed from where the route actually lands. `app/api/chat/route.ts` is
  // three folders down, so the import has to climb back out to reach an index
  // written at the project root.
  const importPath = importFrom(project.route, indexPath)

  if (framework === 'next') {
    return `import { createChatHandler } from '@recourse-ai/core/server'
import knowledge from '${importPath}'

// One handler for both verbs: the browser sends a preflight before it streams.
const handler = createChatHandler({ index: knowledge })

export const POST = handler
export const OPTIONS = handler
`
  }

  if (framework === 'worker') {
    return `import { createChatHandler } from '@recourse-ai/core/server'
import knowledge from '${importPath}'

const chat = createChatHandler({ index: knowledge })

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/chat') return chat(request)

    return new Response('Not found', { status: 404 })
  },
}
`
  }

  return `import { createServer } from 'node:http'
import { createChatHandler } from '@recourse-ai/core/server'
import knowledge from '${importPath}' with { type: 'json' }

const chat = createChatHandler({ index: knowledge })

createServer(async (incoming, outgoing) => {
  const body = incoming.method === 'POST' ? await text(incoming) : undefined
  const request = new Request(\`http://localhost\${incoming.url}\`, {
    method: incoming.method,
    headers: incoming.headers as HeadersInit,
    ...(body ? { body } : {}),
  })

  const response = await chat(request)
  outgoing.writeHead(response.status, Object.fromEntries(response.headers))
  outgoing.end(Buffer.from(await response.arrayBuffer()))
}).listen(3000, () => console.log('http://localhost:3000'))

async function text(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString()
}
`
}

/**
 * The script tag, pointed at wherever the handler ended up.
 *
 * From the CDN rather than an install, because the widget is the one piece
 * that has to reach a browser and a copied line into a template is the
 * shortest path there.
 */
export function snippetFor(endpoint = '/api/chat'): string {
  return `<script
  src="https://cdn.jsdelivr.net/npm/@recourse-ai/widget/dist/recourse.min.js"
  data-endpoint="${endpoint}"
  data-title="Ask us anything"
></script>`
}

/**
 * The index path as the route file has to import it.
 *
 * `ingest` writes to `recourse/knowledge.json` relative to the project root,
 * and the route sits several folders below it, so the import has to climb back
 * out. Getting this wrong is the difference between a file that runs and one
 * that throws on import, and it is invisible until somebody tries it.
 */
export function importFrom(routePath: string, indexPath: string): string {
  const depth = routePath.split('/').length - 1
  return depth > 0 ? `${'../'.repeat(depth)}${indexPath}` : `./${indexPath}`
}
