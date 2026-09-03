# Cutting a release

Four npm packages and a WordPress plugin, on one version number. They move
together because the plugin runs a port of the core and a customer reporting a
bug should be able to name one version that describes what they are running.

The mechanical half is `scripts/release.mjs`. The decisions are here.

## Before you start

```bash
node scripts/release.mjs check
```

It prints the version from all eight places that hold one, then tells you what
is in the way: versions that disagree, a dirty tree, a changelog with no
unreleased section, or a generated file somebody forgot to commit. It rebuilds
the widget bundle and the parity fixtures to find that last one out, so expect
it to take a minute and to leave the rebuilt files in your tree.

Fix everything it names before going on. A release that starts from a dirty
tree ships whatever was lying around.

## Decide the version

Everything here is pre-1.0, so the rule is the loose one: a breaking change
moves the minor, anything else moves the patch. What counts as breaking is
written down in `CHANGELOG.md` under "You have to change something", and if
that section has anything in it, the minor moves.

The plugin has drifted before. It sat at 0.1.0 while the npm packages went to
0.1.1, because a release was cut without it. That is what `check` is for.

## Write the version

```bash
node scripts/release.mjs set 0.2.0
```

Eight files, in three formats:

| File | What reads it |
| --- | --- |
| `packages/core/package.json` | npm |
| `packages/widget/package.json` | npm |
| `packages/store-d1/package.json` | npm |
| `packages/store-postgres/package.json` | npm |
| `packages/wordpress/package.json` | the workspace only, this one is private |
| `packages/wordpress/recourse.php`, plugin header | the WordPress plugins screen |
| `packages/wordpress/recourse.php`, `RECOURSE_VERSION` | the plugin at runtime |
| `packages/wordpress/readme.txt`, `Stable tag` | the plugin directory |

It also turns the changelog's `(unreleased)` heading into a dated release. It
writes nothing at all if any one of those steps cannot be done, so a failure
leaves you where you started rather than half a version in.

Then read the changelog yourself. The script dates it; whether it describes
what actually changed is a judgement no script makes.

## Verify

```bash
pnpm verify:ci
```

Build, lint and test across every package, plus the demo build, the examples
lint, the worker size budget, and the two staleness gates. This is the same
command CI runs, so a red result here is a red result there.

## Commit and tag

```bash
git add -A
git commit -m "release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

`git add -A` rather than `commit -a`, because the rebuilt bundle may be a file
git has not seen before.

## Publish to npm

```bash
pnpm -r --filter "./packages/*" publish --access public
```

The WordPress package is marked private, so this skips it without being told
to. Publishing is the one step with no undo: a version number on npm cannot be
reused, even after `npm unpublish`.

## Publish the plugin

The plugin does not go to npm. It is zipped from an allowlist so nothing from
the workspace ends up on somebody's server:

```bash
pnpm --filter @recourse-ai/wordpress package
```

That writes `packages/wordpress/dist/recourse.zip`. Attach it to the GitHub
release for the tag you just pushed.

The plugin directory is separate again, and slower: it has its own review, its
own subversion repository, and it serves whatever `Stable tag` in `readme.txt`
points at. Do not move that tag until the matching tag exists in their
subversion, or the directory will offer an update it cannot serve.

## Afterwards

- `npm view @recourse-ai/core version` returns the new number, and the same for
  the other three.
- The GitHub release has the plugin zip on it.
- Redeploy the demo, so the page people are pointed at runs what was just
  published: `cd examples/demo && npm run deploy`.
