<!--
Keep this short. Delete any line that does not apply.
CONTRIBUTING.md has the detail: https://github.com/ibrahimhajjaj/recourse/blob/main/CONTRIBUTING.md
-->

Closes #

## What this changes

<!-- One or two sentences. The diff shows what; say why, if the diff cannot. -->

## AI usage

<!--
Which tool, and how much of the work it did. "None" is a perfectly good answer.
This is not held against you. It tells the reviewer where to look hardest.
-->

## Checked

- [ ] `pnpm verify` passes
- [ ] I can explain what this does without an agent open in front of me
- [ ] I broke the code on purpose and watched the new test catch it
- [ ] If it changed the tokeniser or the ranking, the PHP port changed too and the parity fixture is regenerated
- [ ] If it changed retrieval, `pnpm --filter @recourse-ai/evals eval -- --suite retrieval` still holds up
