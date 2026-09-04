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
import { sendWhatsAppTemplate, whatsAppTemplates } from '@recourse-ai/core'

await sendWhatsAppTemplate(
  { phoneNumberId, accessToken },
  { to: '447700900000', template: 'order_shipped', language: 'en_GB', variables: ['Sam', 'LUM-1234'] },
)
```

Write `to` however your list has it. WhatsApp wants digits, and an export from
a CRM has `+44 7700 900000` in it, so the punctuation is taken out for you
rather than failing once per recipient at send time.

The values are positional, filling the template's `{{1}}` and `{{2}}` in order,
because that is what the API takes. Meta rejects a message whose count does not
match the approved body, which is the right failure: the alternative is a
customer reading "Hi {{1}}".

Check the list before a run rather than during one. A template still awaiting
review, or rejected last week, fails once per recipient, and finding that out on
the four thousandth is not a good way to find out:

```ts
const approved = await whatsAppTemplates({ businessAccountId, accessToken })
```

It reports each template's status and how many values it needs. Note that it
takes the business account id, not the phone number id: two different numbers on
the same dashboard, and the easiest thing here to get wrong.

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
