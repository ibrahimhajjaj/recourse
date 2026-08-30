# Channels, and what has actually been proved

Eleven adapters ship. Seven have been through real traffic from real accounts on a
real phone. One more is wired and blocked on a commercial gate rather than on
anything technical. The rest are verified against each platform's documented
signature examples and mocked send paths, which is a weaker claim, and this
file exists so the difference is never blurred in a README.

The seven cover every signature scheme in the set, which is the reason to stop
where it stops rather than a reason to be sorry about the rest: an HMAC over the payload
(WhatsApp, Messenger), an HMAC over a timestamped payload (Slack), an HMAC over
the exact URL, Ed25519 (Discord), and no signature at all with a shared secret
instead (Telegram). Only the third of those is not now proved against the
platform that invented it, and Twilio's published example signature is
reproduced byte for byte offline.

| Channel | Handshake | Receive | Send | Rejects | Live on |
| --- | --- | --- | --- | --- | --- |
| WhatsApp | yes | yes | yes | yes | 2026-08-29 |
| Telegram | yes | yes | yes | yes | 2026-08-29 |
| Discord | yes | yes | yes | yes | 2026-08-29 |
| Slack | yes | yes | yes | yes | 2026-08-30 |
| Messenger | yes | yes | yes | yes | 2026-08-30 |
| Instagram | yes | blocked | mocked | yes | disconnected |
| SMS (Twilio) | n/a | fixture | errors only | fixture | partly, 2026-08-30 |
| Voice (Twilio) | no | fixture | mocked | fixture | not yet |
| Voice (ElevenLabs) | n/a | yes | yes | yes | 2026-08-30 |
| Teams | n/a | yes | yes | yes | 2026-08-30, via Bot Connector |
| Email | no | fixture | mocked | fixture | not yet |
| Sunshine | n/a | fixture | mocked | fixture | not yet |

"fixture" means the platform's own documented payload shape drives the test,
and it is stronger than the word suggests. `packages/evals/src/channel-harness.mts`
stands the adapters up on a real HTTP server and drives seven of them with
genuinely signed requests: Meta's HMAC over the payload, Slack's HMAC over a
timestamped payload, Twilio's over the exact URL, Discord's Ed25519, Telegram's
shared secret. Each is checked three ways, accepted when signed, answered, and
refused when tampered with, plus Slack's replay window and Meta's subscribe
handshake. 26 checks, and Twilio's published example signature is reproduced
byte for byte.

The three not in that harness are covered by scheme rather than by neglect:
Instagram signs exactly as Messenger does, voice signs exactly as SMS does, and
Teams verifies a JWT which has its own fourteen tests. Teams has since been
driven live as well, which is where its two worst defects came from.

None of that is the same as a real request from the real platform, which is
what the rows above are about, and the difference is the whole reason this file
exists.

## WhatsApp, 2026-08-29

Meta test number on a free app, no business verification, nothing spent.

Meta's own verify call, not a simulated one:

```
GET /?hub.mode=subscribe&hub.challenge=1323968068&hub.verify_token=...
    &hub_mode=subscribe&hub_challenge=1323968068&hub_verify_token=...
    -> 200 1323968068
```

Every parameter arrives twice, dotted and underscored. No page of Meta's
documentation mentions it.

```
unsigned POST            401
correctly signed POST    200
tampered signature       401
wrong verify token       401
```

Sending: five approved templates listed off the Graph API, `hello_world`
delivered in 1.4s to a verified recipient.

Two things the documentation does not tell you. A number Meta gives you is not
registered with the Cloud API, and every send fails `(#133010)` until one POST
fixes it. And subscribing through the Graph API is more reliable than the
dashboard, whose webhook screen now redirects into a newer flow.

## Telegram, 2026-08-29

@BotFather, `/newbot`, under a minute, no account and no card.

Telegram signs nothing. The secret token you invent and hand to `setWebhook` is
the whole security model, so the adapter refuses to start without one.

```
no secret header    401
wrong secret        401
correct secret      200
```

Answering, over the tunnel, from a local model:

```
<- hey
-> Hey!

<- how can you help me?
-> I can help with your order, account, or coffee questions at Lumen Coffee
   Roasters, what would you like?
```

## Discord, 2026-08-29

Free, and the only channel here where a leaked key is not a breach: you hold
the public half of an Ed25519 pair, so nothing you have can forge a request.

The handshake is stricter than the others and is worth describing, because it
verifies the endpoint rather than trusting it. Saving an interactions URL makes
Discord send two requests: one correctly signed PING that must be answered with
a PONG, and one deliberately invalid that must be rejected. Both, from the
server log:

```
POST / -> 200 {"type":1}     Discord's signed PING, answered
POST / -> 401 bad signature  Discord's invalid probe, rejected
```

It refuses to save the URL unless both behave, so the endpoint has to be
running before the portal will accept it. That is the opposite of Meta, which
saves whatever you type and fails later.

The other thing the other channels do not have: a slash command has to be
registered through the API before anyone can type it, and until it is the bot
appears to do nothing at all. A global registration can take an hour to appear
in clients; a per-guild one is instant.

Receiving is not ticked yet. The endpoint is verified and the command is
registered; what is left is a person typing `/ask` in a server the bot has been
invited to.

### The seventh defect: a footnote marker with no footnote

Asked over Discord how long delivery to Ireland takes, the answer was right and
cited:

```
Delivery to Ireland takes 3-5 working days. [1]
```

There was no way to find out what [1] was. Ibrahim spotted it in the channel.

`answer()` returns the text and the sources it cited, and the chat widget
renders the second beside the first. The shared channel path destructured the
text and dropped the rest on the floor, so every messaging channel had the same
hole: WhatsApp, Telegram, Discord, SMS, email. The prompt asks for a citation
marker on every grounded answer, which means the defect fired on nearly every
useful reply any of them ever sent.

Fixed where the disclosure is fixed, in `answerInBackground`, because that is
the one place every channel passes through and an adapter cannot forget it.
Only cited sources are listed, nothing is appended to an answer with no marker
in it, and a source with no URL is named by title rather than skipped. Discord
renders the result as a real link:

```
United Kingdom orders arrive in 1-2 working days [1].

[1] Shipping: https://shop.example/shipping
```

Worth noting where it was found. Not by a test, not by reading the code, but by
somebody looking at a message in a chat window and asking whether the square
bracket was supposed to do something.

## Messenger and Instagram, 2026-08-29

One server, one callback URL, two products. They are the same product wearing
two logos: the same app secret, the same HMAC over the raw body, the same
verify handshake, the same `/me/messages` send. `live-meta.mts` routes on the
`object` field in the envelope, `page` to Messenger and `instagram` to
Instagram, so one tunnel serves both dashboards.

It reads the body as raw bytes and only peeks at the object with a regex to
choose an adapter. Parsing JSON before verifying is how you end up checking a
signature over something the sender never sent.

Meta verified the endpoint twice, once per product, and both passed:

```
GET ...hub.challenge=1334928374... -> 200 1334928374   (Messenger)
GET ...hub.challenge=1133679718... -> 200 1133679718   (Instagram)
```

Both carry every parameter twice, dotted and underscored, exactly as WhatsApp
does. Still undocumented, now seen three times.

Rejection, over the tunnel with the real app secret:

```
wrong verify token   401
unsigned POST        401
signed POST          200
```

The page subscription was written through the Graph API rather than the
dashboard panel and returned `{"success":true}`. Reading it back fails with a
permissions error, because the page token holds `pages_messaging` and not
`pages_manage_metadata`, which is worth knowing before mistaking the read
failure for a write failure.

Messenger finished on 2026-08-30, and getting there needed two separate faults
fixed rather than one.

The tunnel had died overnight, which is the obvious half. The other half is
worth writing down: `POST /{page-id}/subscribed_apps` returned `{"success":true}`
and Meta still sent nothing, because that call and the **app-level** field
subscription are different things. Only the second decides what Meta delivers,
and it was empty:

```
object: instagram                  active=True  fields:
object: whatsapp_business_account  active=True  fields: messages
object: page                       active=True  fields:            <- here
```

`POST /{app-id}/subscriptions` with `object=page&fields=messages` fixed it. A
page subscription that succeeds while the app subscribes to no fields is a
silent hole: every call returns success and no message ever arrives.

The round trip, from Facebook's own web client:

```
<- how long does UK delivery take
-> UK orders arrive in 1-2 working days [1].

   [1] Shipping: https://shop.example/shipping
```

**Instagram is not ticked, and the reasons are structural.** Four of them, found
one at a time on 2026-08-30, each hiding the next.

**The scopes in the dashboard are dead ones.** The Messenger use case still
lists `instagram_basic` and `instagram_manage_messages` with Add buttons beside
them, and requesting them fails with "Invalid Scopes". They belong to the
Instagram API with Facebook Login. The current one wants
`instagram_business_basic`, `instagram_business_manage_comments` and
`instagram_business_manage_messages`, and it is a separate app with its own id
and its own secret, sitting inside the same Facebook app.

**The Instagram Tester role belongs to a retired product.** The role dialog
describes it as "required by the Instagram Basic Display API", which Meta shut
down in December 2024. Adding an account to it returns "Form can't be saved"
with no reason given.

**Which makes the setup circular.** Adding the account asks you to log in; the
login returns "Insufficient Developer Role"; the fix for that is the tester
role; the tester role will not save. The way out is ordering rather than
persistence: the account has to be professional and public first, because the
role form validates against it, and the dashboard presents these steps in the
opposite order.

**And webhooks need the app published.** Step 3 says so plainly. Messenger
delivers to an unpublished development app and Instagram does not, so even a
finished setup would not receive a message until the app goes live, which is a
decision about the whole app rather than about this channel.

**All four were wrong about the cause, and the real one was simpler.** The
Instagram account was never linked to a Facebook Page. `i4a_code` was already a
professional account, so the guess that it needed converting was wrong. Once it
was connected to "The Key" from the Instagram settings screen, the account
appeared in the developer portal immediately, already switched on for webhooks,
and every route that had been returning "Insufficient Developer Role" simply
worked. The role, the scopes and the login were all downstream of one missing
link, and the dashboard reported the symptom at four different places without
naming it once.

Worth noting the connect dialog offered a business portfolio and an ad account
belonging to somebody else, and picking them would have connected the account
into the wrong place. It has to be the portfolio that owns the app.

State after that: token verified live against `graph.instagram.com` as
`i4a_code`, webhook subscription on, callback verified by Meta's own challenge.
Receiving is untested only because it needs a second Instagram account to send
a direct message from.

Then the same trap as Messenger, which is why it is worth naming rather than
just fixing: the account row in the dashboard said "Webhook Subscription: On",
the callback was verified by Meta's own challenge, and `object: instagram` still
had `fields: (none)`. A message sent to the account produced no request at all.

Two different switches, both called a subscription, and only the app-level one
decides what Meta sends:

```
instagram   active=True  fields: (none)      <- verified, toggled on, delivers nothing
instagram   active=True  fields: messages    <- after POST /{app-id}/subscriptions
```

Hitting this twice on the same app, on two products, suggests it is the default
state rather than a mistake either time. Anything built on Meta webhooks should
check `GET /{app-id}/subscriptions` and assert the fields are non-empty, because
every other signal in the dashboard says everything is fine.

With every layer correct, still nothing arrived. The reason is in Meta's own
Instagram webhooks documentation, stated twice:

> Your app must be set to Live in the App Dashboard for Meta to send webhook
> notifications.

> Apps must be set to Live in the App Dashboard to receive webhook
> notifications.

That was checked against the documentation rather than guessed, after a guess
that the sending account needed a role on the app. It did not. The rule has
nothing to do with who sends.

The same page gives the rest of the bill for this setup, Business Login for
Instagram: Advanced Access, and business verification required. So Instagram
messaging needs a live app, advanced access, and a company verified with Meta.

Messenger needed none of that. Identical app, identical tunnel, identical
verify token, one product delivers to an unpublished development app and the
other refuses. That asymmetry is the finding, and it is not discoverable from
the dashboard, which shows Instagram as configured and switched on.

Everything free was tried before concluding, and this is the list, because the
next person will want to know it was not guesswork:

```
tunnel                200                                        ok
app subscription      instagram: messages, messaging_postbacks    ok
account subscription  messages                                    ok
callback              verified by Meta's challenge, twice         ok
conversation          accepted, no longer a pending request       ok
app mode              Unpublished                                 the blocker
```

Two of those were real discoveries rather than boxes ticked. The app-level
`instagram` object had no fields, exactly as `page` had none, so nothing could
be delivered no matter what else was true. And every test message had gone to
Instagram's **message requests** folder rather than the inbox, because the
sending account does not follow the receiving one. A stranger's first message
to a business is always a request, and nothing in the developer dashboard
mentions it. Accepting the conversation and sending again still produced
nothing.

So the documented rule stands, and it was checked the hard way. Meta's access
levels page does say Standard Access is automatic and needs no verification,
which looked like a way out: it applies to app users who hold a role. It does
not rescue this, because the only mechanism for giving an Instagram account a
role is the Instagram Tester role, and that belongs to the Basic Display API
that Meta retired in December 2024. Its form does not save.

Messenger works on the same unpublished app because the sender there is the
Facebook account that administers it, so a role already exists. Instagram has
no equivalent.

Disconnected on 2026-08-30, from the Facebook Page, the business portfolio and
the app authorisation, and the tokens revoked rather than left lying around for
a channel that cannot receive. Re-linking is a minute's work from the Instagram
professional account settings if the verification ever happens.

Decided to stop here rather than pursue business verification.
Everything technical is done and proven: the token authenticates live as
`i4a_code`, Meta verified the callback with its own challenge, and all three
subscription layers are correct. What remains is Meta's commercial gate, not a
missing piece of setup, and it is a business decision rather than an
engineering one.

A tester role was added afterwards to test the earlier hypothesis, and made no
difference, which is what the documentation predicts.

The app review note in step 5 remains, and step 3 still says webhooks need a
published app, so a real deployment has further to go than a test does.

None of that is a defect in the adapter. Instagram signs exactly as Messenger
does, and Messenger is verified live, so the code path is the same one proved
above. What is unverified is the account plumbing, and it is unverified because
it needs an Instagram password, an account conversion, and a published app,
which are three decisions belonging to whoever owns the account. In development mode only
people with a role on the app may message it, and the Send API needs a
page-scoped user id that does not exist until that person writes first. So the
first message has to come from a human, and the extension refuses to screenshot
messenger.com, so it cannot come from this side. One message from Ibrahim to
the page finishes Messenger.

Instagram needs one thing more: a professional Instagram account linked to the
page. The dashboard says "No page permissions granted" until that exists, and
that is an account setting rather than anything in the developer portal.

## Slack, 2026-08-30

App `ibrahim-dev-testing` in a free workspace, installed with six scopes:
`app_mentions:read`, `chat:write`, `im:write`, `im:history`, `im:read`,
`channels:history`. Nothing spent, no approval to wait for.

Slack is the only channel here that signs a timestamp as well as the body, as
`v0:{timestamp}:{body}`, so it is the only one where replaying a captured
request is a real attack with a real defence. All three cases, against the
running server through the tunnel:

```
valid signature, fresh timestamp        -> 200 {"challenge":"..."}
VALID signature, timestamp 400s old     -> 401
forged signature, fresh timestamp       -> 401
```

The middle one is the point. That request carries a signature Slack itself
would accept as authentic; it is refused on age alone.

Slack then ran its own verification against the same endpoint and marked the
Request URL Verified, which is the platform's check rather than ours.

A direct message, end to end, with the answer arriving in the conversation:

```
<- do you ship to Ireland?
-> Yes, Lumen Coffee Roasters ships to Ireland with delivery taking 3-5 working days [1].
   [1] Shipping: https://shop.example/shipping

<- and to the UK?
-> Yes, UK orders arrive in 1-2 working days [1].
```

The second exchange is the one worth reading twice. "And to the UK?" means
nothing on its own, and half an hour earlier it returned the fallback.

## Slack found four, and three were not about Slack

The first four channels found six defects and every one was in the prompt.
Slack found four, and every one was in the adapters. Three of the four affect
channels that have nothing to do with Slack.

1. **Direct messages were ignored.** They arrive as `message` with
   `channel_type: "im"`, and only `app_mention` was wanted unless
   `respondToAllMessages` was set, which also opens every public channel. So
   the documented way to run a quiet support bot was the way to make it deaf
   to the most direct question there is.

2. **Every message in a direct message started a new conversation.** The key
   was `slack:{channel}:{ts}` and a top-level message carries its own `ts`, so
   the second question was a stranger to the first and anything said once per
   conversation would be said again on every message.

3. **Nothing read the transcript back.** This one is not Slack's. The store had
   been written to since the beginning, and every messaging channel called
   `answer(text, [], ...)` with an empty history, so the store was a write-only
   log. The browser widget was never affected, because there the browser holds
   the conversation and re-sends it, which is exactly why nine channels could
   be wrong without anybody noticing. Fixed at the one seam all of them pass
   through, five exchanges carried forward.

4. **Replies were folded into threads inside direct messages.** Correct in a
   channel, where a thread keeps a support exchange from burying everything
   else. In a direct message it hides the answer behind "1 reply".

Auditing the rest of the adapters in the same pass, on the theory that a defect
found by a fifth channel is rarely alone, turned up two more:

- **Email answered machines.** No check for `Auto-Submitted`,
  `X-Auto-Response-Suppress`, `Precedence: bulk`, list headers, a
  `mailer-daemon` sender, or mail arriving from the inbox's own address. An out
  of office reply would have been answered, and answered again, which is how a
  mail loop starts and how a domain gets blacklisted.
- **SMS truncated.** An answer over 1600 characters was cut with `slice`, and a
  cut answer reads as a complete sentence that happens to be wrong. Split
  across messages now, at a paragraph, then a sentence, then a word.

Each fix was proved by putting the old behaviour back and watching the new test
fail, so none of them is a test that passes either way.

## Voice through ElevenLabs, 2026-08-30

The way to prove the voice path without a phone number, a carrier or a Twilio
account, and the reason it is worth having a second way to answer a phone.
ElevenLabs Agents own the call; the library is the webhook tool their agent
calls mid-conversation. What needed proving is that seam.

Their agent, on a real conversation, calling the real endpoint:

```
GET /?question=How+long+does+delivery+to+Ireland+take?
 -> 200 {"answer":"Delivery to Ireland takes 3-5 working days.","found":true,"sources":["Shipping"]}
agent: "Delivery to Ireland takes three to five working days. Would you like me
        to send these shipping details to you by text or email?"

GET /?question=What+is+the+chief+executive+paid?
 -> 200 {"answer":"I'm not sure about that one...","found":false,"sources":[]}
agent: "I do not have that to hand, but I can take a message and have someone
        call you back."
```

The second exchange is the whole point of the project on a phone call, where a
confident wrong answer is worst: asked something the documentation does not
cover, the agent refused rather than inventing a number, and used the exact
sentence the generated system prompt specifies. It also spoke "3-5" as "three
to five" and offered to send details by text, both of which that prompt asks
for and neither of which a person would tolerate read out as written.

### Their simulator cannot verify this, and says nothing about it

The obvious way to test an agent is `POST /simulate-conversation`, and it is a
trap. It reports the tool as used and the transcript reads plausibly:

> The agent used a search tool for both questions but indicated it did not have
> the information readily available.

The endpoint was never called. Nothing reached the server. In the transcript
each tool call carries `tool_has_been_called: false`, `tool_details: null` and
a result of the literal string `"Tool Called."`, which is what the agent was
given in place of an answer, which is why it said it had none. Simulation mocks
webhook tools. The endpoint is also marked Deprecated.

So an integration verified that way looks tested and is not tested at all, and
the transcript actively argues that the tool is broken. Anything that has to be
proved is driven over the conversation WebSocket instead, where tools really
run: `packages/evals/src/live-elevenlabs.mts --check` first, which costs
nothing and drives every request shape their tool builder can produce, and only
then a real conversation.

## SMS through Twilio, 2026-08-30, as far as it goes

The only channel here whose free path is itself gated, and the row above says
"errors only" because that is the honest word for what was proved.

The account authenticates against the real API and reads back
`My First Twilio Account | status active | type Trial`. It owns no number and
has no verified recipient, and a trial that was never activated cannot even
list available numbers: `AvailablePhoneNumbers` returns 20003, "This feature is
not available on a Trial account". Twilio's Test Credentials, which exercise
the real API without charging or reaching a real number, are not offered either;
the API keys page has a Live credentials section and no Test one.

So no message can be delivered. What can be driven is every send that fails,
which is worth more than it sounds, because the failures are where this channel
is easy to get wrong.

### The documentation was wrong about the one that matters

A trial send was expected to return 21608, the code the error list describes as
the unverified-recipient case. What Twilio actually returns is:

```
HTTP 422 {"code":572002,"message":"No Twilio trial phone number is assigned for
messaging to this destination number. Please add the 'to' number as a verified
recipient."}
```

572002 does not appear in that list at all, the status is 422 rather than 400,
and the message names one of the two missing things while the account is
missing both: no verified recipient and no number to send from. An explanation
written from the documentation would have been confidently wrong, and was, until
a real send corrected it.

That is the third time on this project that live traffic has contradicted a
platform's own documentation, after Meta sending every verify parameter twice
and Meta's `subscribed_apps` reporting success while subscribing to nothing.

### The receive half rests on this

Nothing weaker than before. Twilio signs the exact URL it called with every POST
field appended, sorted by name, concatenated with no delimiter, then HMAC-SHA1
and base64. The harness reproduces Twilio's own published example signature byte
for byte and drives the adapter with genuinely signed requests, accepted when
signed and refused when tampered with. A real inbound SMS would exercise
Twilio's delivery rather than this library's code.

The gap is the success path, and it stays open until the trial is activated with
a number or the account is funded.

## Auditing Teams without an account

Teams cannot be stood up without an Azure subscription, so it was read instead,
against Microsoft's own authentication specification rather than against
judgement. That turned up the most serious defect on the project.

Their spec lists seven checks a bot must make on an inbound request. This
adapter did six. The seventh:

> The token contains a "serviceUrl" claim with value that matches the
> `serviceUrl` property at the root of the Activity object of the incoming
> request.

and immediately after it:

> Failure to implement ALL of these verification requirements will leave the bot
> open to attacks which could cause the bot to divulge its JWT token.

That is not a general warning, it is a description of this exact gap. Teams is
the only channel here where the reply does not go back on the response: the bot
posts it to a service URL, carrying a bearer token that can act as the bot. The
service URL arrives **in the request body**. Verifying the token's signature
while ignoring what it says about the address means the body chooses where the
bot sends its own credentials, and a token that can act as the bot is the bot.

Two fixes, because one of them can be switched off:

1. The seventh check, as written: the address the token was issued for has to
   match the address in the body, compared against the raw body rather than
   against anything a parse produced.
2. A reply address that is not an `https` Bot Connector host is refused
   outright, whatever the mode. The first check is skipped in development, and
   a development affordance that trades the bot's credentials is not one. With
   this, the worst a skipped verification costs is a wrong answer.

Five tests cover it, including a lookalike host
(`botframework.com.attacker.example`) and plain `http`, which would put the
token on the wire in clear. Removing either fix fails four of them.

Worth stating plainly: this was shipped, and no test caught it, because every
test asked whether a correct request works rather than what a hostile one could
extract. The channel had been read several times.

## Teams, through the Bot Connector, 2026-08-30

Azure Bot `helpdeck-dev-testing` on the free F0 tier, on an Azure for Students
subscription. Nothing spent.

The row says "via Bot Connector" because that is what was proved. Installing
into Teams itself needs a Microsoft 365 tenant that permits custom app upload,
and the free developer tenant that used to cover it now requires a paid Visual
Studio subscription. What Direct Line and Web Chat do give is the same Bot
Connector Teams uses: the same signed inbound tokens, the same `serviceUrl`, the
same reply flow. Every line of the adapter runs. Teams-specific activity shapes
do not, and that is the honest limit.

A real conversation, end to end:

```
POST /api/messages -> 200 [serviceUrl https://directline.botframework.com/]
  <- do you ship to Ireland?
  -> Yes, we ship to Ireland with delivery taking 3-5 working days. [1]

what the customer saw:
  helpdeck-dev-testing: Yes, we ship to Ireland with delivery taking 3-5 working
                        days. [1]
                        [1] Shipping: https://shop.example/shipping
```

That inbound was verified in full, including the `serviceUrl` claim check added
after reading Microsoft's specification, against a token Microsoft signed.

### The channel could never have replied

The first attempt answered the question, generated the right text, and delivered
nothing:

```
Teams reply failed: 400 {"error":{"code":"MissingProperty",
  "message":"The 'Activity.From' field is required"}}
```

The reply was posted without a `from`, so the Connector refused all of it. Not
an edge case: no reply this adapter ever sent could have arrived. It survived
because the webhook still answers 200, the failure lands after the
acknowledgement, and every test in the suite handed the channel its own `send`
and so never built the request the Connector actually receives.

The fix is small and the reason is worth keeping: a bot's own identity is not
something it knows about itself. It arrives as the `recipient` of the message
being answered, because on the way in the bot is who the message was addressed
to. Two tests now assert the posted body, one for the identity carried through
and one for the fallback when a channel omits `recipient`.

### Two things about the setup that are not in any quickstart

An app registration is not enough on its own. Without a service principal in the
tenant, the client-credentials grant fails with `AADSTS7000229`, which reads
like a bad secret and is not; the fix is one Graph call, `POST /servicePrincipals`
with the app id.

And `Microsoft.BotService` is not registered on a new subscription. Creating the
bot before registering the provider fails for a reason that says nothing about
providers.

## The defects, and how each was found

Twenty-two defects across two days, and the split is the interesting part. The
first four channels found six, every one in the prompt. The next three found
ten in the adapters, and the two worst were in the channel that could not be
stood up at all and had to be read against its specification instead.

Nothing here was found by the test suite. Every one was found by a real
platform refusing something, or by reading what a vendor said and checking the
code against it. The suite's blind spot has a shape: it asks whether a correct
request works. It does not ask what a hostile one could extract, and it does not
build the request a platform actually receives when a test supplies its own
`send`.

### The six in the prompt

Every one on an input a customer sends in the first thirty seconds:

1. A greeting was answered with the fallback.
2. "Are you human?" was answered with the fallback. In the EU that question has
   to be answered.
3. Three questions in one message got one blanket refusal.
4. A refusal was worded as a failed documentation lookup: "for passwords, I
   don't have that in my documentation".
5. A customer was told to "contact us" while contacting us, then given the
   fallback when he pointed that out.
6. "What can you help with?" retrieves nothing, and where retrieval finds
   nothing the prompt ends with "you have nothing", which beat the rule two
   hundred words above it.

They were also one defect, not six. Each was patched with a rule saying the
fallback did not apply to that case, and all six patches were fencing off the
same sentence: "if the sources do not answer, say this and stop". That sentence
sat at the same level as everything else and won every argument it was allowed
to have, because a greeting is a question the sources do not answer, and so is
"are you human", and so is any part of a message sitting next to one.

The answering section is a procedure now, and the fallback lives inside the one
branch it belongs to. The six exceptions are deleted rather than moved. Thirteen
rules became four branches and five standing rules. `plans/PARITY.md` carries
the reasoning and the evidence.

Two lessons worth carrying to the other eight channels. Rules that survive
contact with a small model are **concrete**: the opener rule quotes the exact
phrases it bans and has never failed, while the same rule written as a concept
was ignored. And rules only win **where they are read**: adding one to the top
of a prompt does not mean it holds at the bottom, which is why the identity line
now appears at both ends.

## Reproducing

Each live channel has a harness beside the others in `packages/evals/src`:

```
pnpm --filter @helpdeck/evals whatsapp -- --templates
pnpm --filter @helpdeck/evals telegram -- --whoami
pnpm --filter @helpdeck/evals discord -- --register
pnpm --filter @helpdeck/evals slack -- --whoami
pnpm --filter @helpdeck/evals elevenlabs -- --check
pnpm --filter @helpdeck/evals twilio -- --whoami
pnpm --filter @helpdeck/evals teams -- --token
```

Teams needs one more step than the others: the bot resource stores the endpoint
by address, so a new tunnel means re-pointing it before anything arrives. A
stale endpoint is silence rather than an error.

Every one needs a tunnel and credentials, and every credential named here is
free. `examples/nextjs/.env.example` says what each one is and which of them
have a step the platform never mentions.
