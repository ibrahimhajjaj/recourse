# Serving it to tools that already speak OpenAI

The widget is not the only place a support agent is useful. A team usually
already runs something that talks to a model: an internal chat interface, a
Slack bot, a script, a desktop client. All of them speak one protocol, and none
of them speak this one.

`createOpenAiHandler` serves the same agent at `/v1/chat/completions`. Point any
of those at the URL and the answers come back grounded in your own content, with
the safety screens and the actions, instead of whatever the model happens to
know. Nothing is written on their side and no library is added.

```ts
import { createOpenAiHandler, models } from '@recourse-ai/core/server'
import knowledge from './knowledge.json' with { type: 'json' }

export default {
  fetch: createOpenAiHandler({
    index: knowledge,
    model: models.fromEnvironment(),
    served: 'lumen-support',
  }),
}
```

It takes the same options as `createChatHandler`, so the persona, actions,
procedures, rate limits and safety settings are the ones you already configured.
Run both if you want the widget as well; they build the agent the same way.

Any client works. This is the official SDK, unmodified:

```ts
import OpenAI from 'openai'

const client = new OpenAI({ baseURL: 'https://support.example/v1', apiKey: 'unused' })

const answer = await client.chat.completions.create({
  model: 'lumen-support',
  messages: [{ role: 'user', content: 'can I get a refund?' }],
})
```

`GET /v1/models` answers too, which matters more than it sounds: a client that
populates a picker calls it first and shows an empty list when it 404s, which
reads as a broken URL to whoever is configuring it. `served` is the name it
reports. Call it after the business, not after the model underneath: someone
choosing between two of these is choosing between businesses, and naming the
weights tells them nothing and leaks something.

## What a translation cannot carry

Two things are worth knowing before you point a client at this.

**Anything meant for a browser is dropped.** A form, a button, a card, a
suggested reply and a client action are all instructions to a page, and there is
no page. A caller over this API gets the words and nothing else, which is the
honest translation rather than a description of a button nobody can press.
Notices and a handover message are the exception and arrive as text, because a
refused file is something the reader has to be told and there is nowhere else to
tell them.

**Citations become a footer.** The agent cites as `[1]`, and the protocol has
nowhere to put a list of what the numbers mean. Left alone, the reader gets
bracketed digits referring to nothing, so the sources are appended under the
answer. Set `citations: false` if the client renders its own.

**Only the last ten messages are read**, and each is truncated at four thousand
characters. A client with a chat window that has been open all week will happily
post its entire history, and every message of it would be paid for on every turn
before eventually not fitting in the model at all. `maxHistory` changes the
number.

A system message from the caller is dropped rather than obeyed. The question
underneath it is still answered normally; what is refused is the caller
rewriting the instructions the business set, which is otherwise a way around
every rule configured here by anyone who can reach the URL.

---

[Back to the README](../README.md)
