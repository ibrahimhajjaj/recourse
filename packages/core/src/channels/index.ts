export { whatsappChannel, type WhatsAppOptions } from './whatsapp.js'
export { slackChannel, type SlackOptions } from './slack.js'
export {
  messengerChannel,
  instagramChannel,
  metaMessagingChannel,
  type MetaMessagingOptions,
} from './meta.js'
export { twilioChannel, type TwilioOptions } from './sms.js'
export { telegramChannel, type TelegramOptions } from './telegram.js'
export { discordChannel, verifyDiscord, type DiscordOptions } from './discord.js'
export { teamsChannel, stripMentions, type TeamsOptions, type TeamsReplyTarget } from './teams.js'
export {
  voiceChannel,
  createVoiceSession,
  buildTwiml,
  buildHandoffTwiml,
  type VoiceAnswerOptions,
  type VoiceSessionOptions,
  type VoiceCallState,
  type InboundVoiceMessage,
  type OutboundVoiceMessage,
  type VoiceSetupMessage,
  type VoicePromptMessage,
  type VoiceInterruptMessage,
  type VoiceDtmfMessage,
} from './voice.js'
export { toSpeech, createSentenceBuffer } from './voice-speech.js'
export { gatherVoiceChannel, type GatherVoiceOptions } from './voice-gather.js'
export {
  createSpeechCache,
  elevenLabsVoice,
  openAiCompatibleVoice,
  speechRoute,
  type Voice,
  type SpeechCache,
  type ElevenLabsVoiceOptions,
  type OpenAiVoiceOptions,
} from './voice-tts.js'
export {
  elevenLabsToolRoute,
  elevenLabsSystemPrompt,
  type ElevenLabsToolOptions,
} from './voice-elevenlabs.js'
export { verifyJwt, fetchSigningKeys, clearKeyCache, type JwtClaims, type VerifyJwtOptions } from './jwt.js'
export { emailChannel, parseCommonEmail, stripQuoted, type EmailOptions, type InboundEmail } from './email.js'
export {
  verifyMeta,
  verifySlack,
  verifyTwilio,
  signMeta,
  signSlack,
  signTwilio,
  safeEqual,
} from './verify.js'
export { defaultDisclosure } from './shared.js'
export type { Citations } from './shared.js'
export type { ChannelBase, InboundMessage } from './shared.js'
export {
  elevenLabsTranscriber,
  openAiCompatibleTranscriber,
  transcriptionRoute,
  type Transcriber,
  type Transcript,
  type TranscribeOptions,
  type TranscriptionRouteOptions,
} from './voice-stt.js'
export {
  listTemplates,
  sendTemplate,
  templateSender,
  type MessageTemplate,
  type TemplateVariable,
  type SendTemplateOptions,
} from './whatsapp-templates.js'
export { sunshineChannel, type SunshineOptions } from './sunshine.js'
export { intercomChannel, type IntercomOptions } from './intercom.js'
