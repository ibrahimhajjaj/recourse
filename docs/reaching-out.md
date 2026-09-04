# Messages you start, and telling other systems

Two things that both point outward, and both have a way of going wrong at scale
rather than in testing.

## Campaigns

```ts
import { runCampaign } from '@recourse-ai/core/outbound'
```

Sending is the easy part. The hard parts are the three mistakes you only make
once:

- **Sending to people who never agreed to hear from you.** Consent is required
  per recipient and the default is no. A recipient without an explicit `true` is
  skipped rather than sent to, because the other default is the one that gets a
  number banned and, in several countries, is unlawful.
- **Sending the same thing twice** because a run was retried after a timeout.
- **Sending fast enough that the provider blocks the number**, which ends the
  channel for everybody, not just the campaign.

All three are handled here rather than left to the caller, on the grounds that
every one is discovered the expensive way.

### On WhatsApp, the wording is not yours to choose

WhatsApp will not carry a message you wrote to somebody who has not written to
you in the last 24 hours. Outside that window the only thing that goes through
is a template Meta approved in advance, with its variable parts filled in.
Plain text there fails with a code most people read as a broken token, and the
fix is not a bigger retry.

```ts
import { listTemplates, sendTemplate } from '@recourse-ai/core/channels'

const approved = await listTemplates({ accessToken, wabaId })

await sendTemplate({
  accessToken,
  phoneNumberId,
  to: '+44 7700 900000',
  template: { name: 'order_shipped', variables: ['Sam', 'LUM-1234'] },
  known: approved,
  wabaId,
})
```

Write `to` however your list has it. WhatsApp wants digits, and an export from
a CRM has `+44 7700 900000` in it, so the punctuation is taken out for you
rather than failing once per recipient at send time.

The values are positional, filling the template's `{{1}}` and `{{2}}` in order,
because that is what the API takes. Meta rejects a message whose count does not
match the approved body, which is the right failure: the alternative is a
customer reading "Hi {{1}}".

Read the list before a run rather than during one. Only approved templates come
back, because one still in review cannot be sent and offering it to somebody
building a campaign is offering them a failure in a few minutes' time. Passing
that list as `known` buys two checks Meta's own errors will not give you: a
name that exists in several languages with none given, and the one that catches
everybody, a template paired with a number from a different business account.

`listTemplates` takes the business account id, not the phone number id. They are
two different numbers on the same dashboard and it is the easiest thing here to
get wrong.

## Webhooks going out

```ts
import { createWebhooks } from '@recourse-ai/core/webhooks'
```

The store tells you what happened inside your own deployment. A webhook tells
everything else. A captured lead belongs in the CRM and an opened ticket belongs
on the on-call rota, and neither should need something polling an API to find
out.

Deliveries are signed with `signWebhook`, and `verifyWebhook` is exported too so
the receiving end can check them, which means your own services can tell your
events from anyone else's post to the same URL. That matters more than it sounds: an unsigned
webhook endpoint is an open invitation to create tickets in your help desk.

---

[Back to the README](../README.md)
