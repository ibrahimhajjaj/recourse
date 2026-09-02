/**
 * Builds the demo's knowledge base out of this project's own documentation.
 *
 * The demo answers questions about itself, which is the only content that is
 * both honestly ours and worth reading. A made-up coffee shop demonstrates the
 * mechanism and tells a visitor nothing they wanted to know; the documentation
 * answers the question they actually arrived with.
 *
 * Keyword only, with no embeddings, because that is the path somebody gets
 * before they have signed up for anything. If the demo needs an account to look
 * good, it is demonstrating the wrong thing.
 */

import { writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, textSource } from '@recourse-ai/core'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

/** A heading a reader would recognise, rather than a filename. */
const titleOf = (markdown, fallback) =>
  markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback

const documents = []

for (const name of readdirSync(join(repo, 'docs')).filter((file) => file.endsWith('.md'))) {
  const text = readFileSync(join(repo, 'docs', name), 'utf8')
  documents.push({
    id: `docs/${name}`,
    title: titleOf(text, name.replace(/\.md$/, '')),
    text,
    url: `https://github.com/ibrahimhajjaj/recourse/blob/main/docs/${name}`,
  })
}

const readme = readFileSync(join(repo, 'README.md'), 'utf8')
documents.push({
  id: 'README.md',
  title: titleOf(readme, 'recourse'),
  text: readme,
  url: 'https://github.com/ibrahimhajjaj/recourse#readme',
})

const index = await buildIndex({ sources: [textSource(documents)] })

writeFileSync(join(here, 'src', 'knowledge.json'), JSON.stringify(index))

console.log(
  `${documents.length} documents, ${index.stats.chunks} chunks, ` +
    `${(JSON.stringify(index).length / 1024).toFixed(0)} KB`,
)
