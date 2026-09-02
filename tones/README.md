# Tones

A tone is how the agent writes. Not what it knows, not what it is allowed to
do: those are the index and the actions, and a tone can change neither.

Four are built in. Name one:

```ts
persona: { name: 'Ada', business: 'Lumen Coffee Roasters', tone: 'warm' }
```

`plain` direct and unfussy. `warm` acknowledges a problem before fixing it.
`brisk` the shortest correct answer, then stops. `formal` full sentences, no
contractions.

## Writing your own

A tone is a list of lines starting with a dash. That is the entire format.

```md
# Night shift

For a team answering at 3am. Anything that is not a dashed line is ignored,
so notes like this one can live in the file.

- Assume they are tired and reading on a phone.
- Lead with the fix. Explanation second, and only if it changes what they do.
- Never ask them to check something they have obviously already checked.
```

Pass the file's contents where a name would go:

```ts
persona: { tone: readFileSync('tones/night-shift.md', 'utf8') }
```

That path is a file in your own repository, not one inside the package. The
three packs in this folder are examples to copy: take `first-line.md`,
`night-shift.md` or `regulated.md` into your project, edit the lines until they
sound like your team, and hand the contents to `tone:` as a string.

In WordPress, tick "Use a tone I paste in instead" and paste it.

Sharing one is sending the file. Adopting one is pasting it. There is no
registry to publish to and no format to learn, which is the point.

## The shape of a good one

Rules that change a sentence. "Lead with the fix" changes sentences. "Be
professional" does not, because a model already trying to be professional
cannot try harder, and adjectives are what people reach for when handed an
empty box.

Write what you would tell a new hire on their first shift, the specific things
you would only know from reading what your customers actually send.

Twelve rules is the cap. Past that a tone stops being a voice and starts being
a second system prompt, competing with the rules that keep answers true. If
yours needs more than twelve, some of it is policy rather than voice, and
policy belongs in `instructions`.

## The limits of a tone

It cannot loosen grounding, invent a refund policy, or talk the agent out of
saying it does not know. Voice shapes the sentence, never the fact. A warm
agent that makes something up to be nice has done more damage than a curt one.
