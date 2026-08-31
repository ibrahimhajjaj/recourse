# Letting a non-developer fix a wrong answer

Configuration is code here, and that is right for a developer and wrong for the
support lead who knows exactly which question the agent keeps failing and
cannot fix it without asking somebody.

```ts
import { createChatHandler } from 'recourse/server'
import { knowledgeActions, ASSISTANT_PROMPT } from 'recourse'

createChatHandler({
  index,
  actions: knowledgeActions({ knowledge, store }),
  prompt: () => ASSISTANT_PROMPT,
})
```

Behind your admin token, that is a chat window that does one loop:

```
> What questions could you not answer this week?
  This week, the agent couldn't answer 4 questions about shipping to Norway.

> Add an answer for that: Norway takes 5 to 7 working days and costs 12 euro.
  The answer has been added. It needs a retrain to take effect. Would you like
  me to run a retrain now?

> Now retrain.
  Retrain completed. The index now holds 2 sources and 2 chunks.
```

It can reach exactly what the management API can: gaps, answers, notes,
sources, retrain. It cannot change a setting, a threshold, a procedure or the
prompt, and its instructions say so in those words, because a model with no
answer to "can you change the tone" invents one and then tries.

Removing a source renders as a button somebody presses rather than something the
model does on its own judgment. A model reading "we do not sell the blue one any
more" as an instruction to delete the product page has done something that is not
obvious afterwards, unlike a wrong answer.

That is the default rather than a law: `confirmDeletes: false` hands the model
the delete outright. It exists because somebody will genuinely want it, and it is
named so that turning it off is a decision rather than an accident.

---

[Back to the README](../README.md)
