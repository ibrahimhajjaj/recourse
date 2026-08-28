import type { Document, Source } from '../types.js'

/**
 * An escape hatch for content that lives somewhere this package does not know
 * about: a CMS, a database, a Notion export. Fetch it yourself, hand it over.
 */
export function textSource(documents: Document[]): Source {
  return {
    name: 'text',
    async load() {
      return documents
    },
  }
}
