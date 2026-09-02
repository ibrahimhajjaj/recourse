/**
 * The support agent as a Cloudflare Worker.
 *
 * The whole point of this example is what is *not* here: no `nodejs_compat`
 * flag, no polyfills, no adapter. `createChatHandler` returns a
 * `Request -> Response` function, which is exactly what a Worker is.
 *
 * The index is imported, so it is bundled with the Worker and there is nothing
 * to fetch at startup. A cold start is a JSON parse.
 *
 * Attachments go to R2 through a binding, which is the part a Worker does
 * better than anywhere else: no credentials in the environment, no signature
 * to compute, and the bytes never leave Cloudflare's network on the way in.
 */

import { createChatHandler, uploadRoute, downloadRoute } from '@recourse-ai/core/server'
import { r2Blobs, type R2Like } from '@recourse-ai/core/storage'
// Subpaths, not the root export: `recourse` re-exports `ingest`, which reads
// from disk and so imports `node:fs`. Nothing below touches the filesystem.
import { models } from '@recourse-ai/core/models'
import {
  attachCall,
  elevenLabsVoice,
  openAiCompatibleTranscriber,
  openAiCompatibleVoice,
} from '@recourse-ai/core/channels'
import { createAgent } from '@recourse-ai/core/agent'
import type { KnowledgeIndex } from '@recourse-ai/core/agent'
import knowledge from './knowledge.json'

interface Env {
  /** A model id for the AI Gateway, or leave it unset for the default. */
  RECOURSE_MODEL?: string
  /** Any OpenAI-compatible endpoint, including Workers AI. */
  OPENAI_COMPATIBLE_BASE_URL?: string
  OPENAI_COMPATIBLE_API_KEY?: string
  OPENAI_COMPATIBLE_MODEL?: string
  /** The R2 bucket, from `wrangler.jsonc`. Absent until one is configured. */
  ATTACHMENTS?: R2Like
  /**
   * Signs the keys the upload route hands out, so a browser cannot name
   * somebody else's file. `wrangler secret put RECOURSE_UPLOAD_SECRET`.
   */
  RECOURSE_UPLOAD_SECRET?: string
  /**
   * Speech in and speech out, for a call the Worker carries itself.
   *
   * One provider can do both, and the same one can answer as well: a single
   * OpenAI-compatible host that offers a transcription model and a speech
   * model needs one key for the whole call. `ELEVENLABS_*` is there for
   * somebody who wants their voices specifically, not because a second
   * account is required.
   */
  TRANSCRIBE_BASE_URL?: string
  TRANSCRIBE_API_KEY?: string
  TRANSCRIBE_MODEL?: string
  SPEAK_BASE_URL?: string
  SPEAK_API_KEY?: string
  SPEAK_MODEL?: string
  SPEAK_VOICE?: string
  /** `wav` where the host will not take mp3, which some will not. */
  SPEAK_FORMAT?: 'mp3' | 'wav' | 'opus'
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_VOICE_ID?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Storage is optional. Without a bucket bound, the agent still answers and
    // still takes small inline attachments; it just has nowhere to put a
    // 20MB scan.
    const storage =
      env.ATTACHMENTS && env.RECOURSE_UPLOAD_SECRET
        ? {
            // No `publicBase`: this bucket is private, so there is no URL a
            // model provider could fetch. Images are sent as bytes instead,
            // which is also the only thing that works for a model on a
            // private network. Put a custom domain on the bucket and pass it
            // here if you would rather hand out links.
            blobs: r2Blobs(env.ATTACHMENTS),
            secret: env.RECOURSE_UPLOAD_SECRET,
          }
        : undefined

    if (url.pathname === '/api/upload' && storage) {
      return uploadRoute({ ...storage, cors: {} })(request)
    }

    if (url.pathname === '/api/file' && storage) {
      return downloadRoute({ ...storage, cors: {} })(request)
    }

    // A call the Worker carries end to end. This is the one thing a Worker
    // does that a serverless function cannot: `WebSocketPair` is native here,
    // so there is no upgrade to negotiate and no server to keep running.
    if (url.pathname === '/api/voice/call') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('expected a websocket upgrade', { status: 426 })
      }

      if (!env.TRANSCRIBE_BASE_URL || !(env.SPEAK_BASE_URL || env.ELEVENLABS_API_KEY)) {
        // Refused rather than accepted and left silent. A socket that opens
        // and never answers looks like a network fault to the caller.
        return new Response('calling is not configured on this deployment', { status: 503 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
      server.accept()

      attachCall(server as unknown as Parameters<typeof attachCall>[0], {
        agent: createAgent({
          index: knowledge as unknown as KnowledgeIndex,
          model: models.fromEnvironment(env as Record<string, string | undefined>),
          embedder: false,
          persona: {
            name: 'Ada',
            business: 'Lumen Coffee Roasters',
            // Written for an ear. A citation marker is noise out loud and a
            // paragraph is more than anybody can hold in their head.
            instructions:
              'You are being read aloud on a call. Answer in one or two short spoken sentences, ' +
              'with no markdown and no citation markers. ' +
              'Reply in the language the caller is speaking.',
            fallback: "I can't find that in our help pages. Shall I put you through to someone?",
          },
          // Sized for the thinking as well as the answer. At 120 a reasoning
          // model spent 106 tokens thinking and had fourteen left, so a caller
          // asking how to pause a subscription heard "To pause your" and
          // nothing else. The instruction above is what keeps replies short;
          // this is only the backstop.
          maxOutputTokens: 400,
          // English pages, callers in any language. The search key is put into
          // the language the content is written in; the reply is not.
          searchLanguage: { language: 'English', model: models.fromEnvironment(env as Record<string, string | undefined>) },
        }),
        transcriber: openAiCompatibleTranscriber({
          baseURL: env.TRANSCRIBE_BASE_URL,
          ...(env.TRANSCRIBE_API_KEY ? { apiKey: env.TRANSCRIBE_API_KEY } : {}),
          ...(env.TRANSCRIBE_MODEL ? { model: env.TRANSCRIBE_MODEL } : {}),
        }),
        // Whichever is configured. The compatible one first, so a deployment
        // with a single key for everything does not also need an ElevenLabs
        // account to make a call.
        voice: env.SPEAK_BASE_URL
          ? openAiCompatibleVoice({
              baseURL: env.SPEAK_BASE_URL,
              ...(env.SPEAK_API_KEY ? { apiKey: env.SPEAK_API_KEY } : {}),
              ...(env.SPEAK_MODEL ? { model: env.SPEAK_MODEL } : {}),
              ...(env.SPEAK_VOICE ? { voice: env.SPEAK_VOICE } : {}),
              ...(env.SPEAK_FORMAT ? { format: env.SPEAK_FORMAT } : {}),
            })
          : elevenLabsVoice({
              // Both, not one. The voice id goes straight into the request URL
              // and there is no sensible default for it, so omitting it built a
              // request to `/text-to-speech/undefined` that failed on the call
              // rather than at startup.
              apiKey: env.ELEVENLABS_API_KEY as string,
              voiceId: env.ELEVENLABS_VOICE_ID as string,
            }),

        // Spoken on connect. Without one the caller hears silence and cannot
        // tell whether the call is up, so they say "hello?" twice and hang up.
        greeting: 'Hello, Lumen Coffee. How can I help?',

        // A call with no cap is a bill with no cap: a forgotten tab with an
        // open microphone bills for speech recognition until it is closed.
        maxCallMs: 10 * 60_000,

        // How eager the agent is to stop talking when somebody speaks over it.
        // The single most complained-about behaviour in voice agents, so it is
        // a setting rather than a constant.
        turns: {
          bargeInMs: 300,
          endOfTurnSilenceMs: 700,
        },

        onTurn: ({ question, answer, ms }) => {
          console.log(`[call] ${ms}ms  ${question} -> ${answer.slice(0, 60)}`)
        },
      })

      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname !== '/api/chat') {
      return new Response('POST to /api/chat', { status: 404 })
    }

    // Built per request rather than at module scope: a Worker's environment
    // arrives with the request, not before it.
    const handler = createChatHandler({
      index: knowledge as unknown as KnowledgeIndex,
      // The Worker's variables are passed in rather than read from a global,
      // because there is no `process` here to read one from.
      model: models.fromEnvironment(env as Record<string, string | undefined>),
      // Keyword-only unless an embedder is configured, which needs no
      // credential and is why this runs with nothing set up at all.
      embedder: false,
      persona: {
        name: 'Ada',
        business: 'Lumen Coffee Roasters',
        fallback: "I can't find that in our help pages.",
      },
      ...(storage ? { storage } : {}),
    })

    return handler(request)
  },
}
