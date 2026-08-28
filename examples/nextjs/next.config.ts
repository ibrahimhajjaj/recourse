import type { NextConfig } from 'next'

const config: NextConfig = {
  // Next.js writes AGENTS.md and CLAUDE.md into the project otherwise. This is
  // a library example, and those files are the reader's choice, not ours.
  agentRules: false,
}

export default config
