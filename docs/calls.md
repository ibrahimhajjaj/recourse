# Talking to it

A Call button in the widget, on the page the visitor is already reading. No
phone number, no telephony account, nothing to install. They click, they talk,
it talks back, and it can look up their order while they are still speaking.

People reach for this when the thing they want to ask is on the screen in front
of them and typing it would take four sentences.

## Two ways to run it

**Let a voice service carry the call.** They own the conversation: the
turn-taking, the interruptions, the voice. Your server is a webhook they call
mid-sentence to get a fact. Nothing to run, and it works this afternoon.

**Carry it yourself.** The browser opens a socket to your own server, sends the
microphone, and gets speech back. The answer comes from the same agent that
answers your chat, so your persona, your safety rules and your procedures are
all still in charge of what gets said. You run a transcriber and a voice, and
their speed is yours to own.

Switching between them is one attribute:

```html
<script src="/recourse.js" data-endpoint="/api/chat" data-call="/api/voice/call"
        data-call-transport="hosted"></script>
```

Drop `data-call-transport` and the vendor carries it instead. Everything else
is the same, because both satisfy the same interface and the widget does not
know which one is running.

## Which one

Take the vendor path if you are taking a handful of calls a day and want it
working today. Take your own if you are taking a lot of them, or if what the
agent is allowed to say matters enough that you do not want a third party
composing it.

The numbers, because they are the whole argument. A support call runs about four
minutes, so at twenty calls a day you are paying **$14 a month running it
yourself against $192 letting a platform run it.** At five calls a day it is $3
against $48, which is not worth thinking about, so do not: take the platform.

The crossover is somewhere around twenty calls a day. Below it the saving is a
sandwich. Above it, at fifty calls a day you are keeping four hundred and fifty
dollars a month. [costs](costs.md) has the table and where the money goes.

You are not saving that outright, you are paying it in operations instead. Start
on the vendor path and move when the minutes hurt. Moving does not mean
rewriting the agent.

## While you talk

**It answers a sentence at a time.** Speech starts on the opening clause while
the rest is still being written, which is most of what makes a call feel quick.

**You can talk over it.** Interrupting abandons the whole answer, not just the
clause in the air, because finishing a sentence nobody is listening to is worse
than saying nothing. How eager it is to stop is a setting, not a constant, since
the right answer differs between a quiet office and a train.

**It can look things up.** The same actions the chat uses. An order lookup
mid-sentence is the difference between a demo and something useful.

**It follows the language you speak.** Taken from what you actually said, not
from a setting, so one call can change language halfway through. See
[languages](languages.md), including the part where English help pages match
nothing against a question asked in Arabic unless you tell it to translate the
search.

## The WebRTC question

It comes up every time, so here is the honest version.

Both a WebSocket and WebRTC carry sound both ways. The difference is what
happens when the network drops a packet. A WebSocket runs on TCP, which
guarantees delivery **in order**, so a lost packet holds up everything that
arrived behind it while it gets re-sent. For a file that is exactly right. For a
live voice it is the wrong trade: you would rather have a small gap in the sound
than a freeze waiting for audio nobody will hear any more. WebRTC runs on UDP,
where a lost packet is simply gone, and it brings a jitter buffer and loss
concealment with it.

So WebRTC is better on a bad network. That much is true and not in dispute.

What is in dispute is how much better, because **nobody has published a
controlled comparison of the two for browser audio under induced packet loss.**
The best known write-up arguing for WebRTC contains no measurements at all. The
one real side-by-side that has been published measured 1,920ms against 2,060ms,
a difference of about a seventh of a second, and that team went back to
WebSockets.

The industry does not agree with itself either. Some voice platforms ship both.
One deprecated its WebSocket path. One serious speech company is WebSocket-only
in the browser. If the answer were obvious they would have all landed in the
same place.

**This library stays on the WebSocket**, for a reason that has nothing to do
with audio quality: WebRTC cannot be terminated on Cloudflare Workers, Vercel
functions or Deno Deploy. Supporting it natively means telling you to go run a
Node server, plus a STUN server, plus a TURN relay, which is where about four
per cent of connections end up on a server-terminated setup and all of them do
behind a firewall that blocks UDP. That is a lot of infrastructure to buy a
seventh of a second.

Two honest footnotes.

**If you want WebRTC, the seam is real.** `attachCall` takes anything that sends
and receives, and the widget takes anything socket-shaped, including a data
channel that reports itself open in words rather than as a number. Cloudflare
also sells an adapter where their edge terminates the WebRTC and hands your
Worker plain audio, which is the one way to have both without leaving the
platform.

**The transport is not your bandwidth problem.** We send raw 16-bit audio at
16kHz, which is about 256 kbps up. Opus would be around 24. On a weak mobile
connection that gap matters more than TCP versus UDP does, and it is the thing
to fix first if calls are rough in the field.

## How long a caller waits

Measured, one provider doing all three parts, real audio in and out:

```
English    2.4s to the first sound, 5.7s to the last
Arabic     3.3s to the first sound, 6.0s to the last
```

The first number is the one that matters. It is when the caller stops waiting.
The gap between the two languages is the extra call that puts the question into
the language the help pages are written in.

The model is nearly all of it. Retrieval costs nothing here because the index is
read from memory in the same process. So give the call its own fast model rather
than sharing the one answering chat, and cap the answer: a reply written for a
screen can be skimmed, and one read aloud cannot.
