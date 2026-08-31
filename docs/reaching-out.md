# Messages you start, and telling other systems

Two things that both point outward, and both have a way of going wrong at scale
rather than in testing.

## Campaigns

```ts
import { runCampaign } from 'recourse/outbound'
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

## Webhooks going out

```ts
import { createWebhooks } from 'recourse/webhooks'
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
