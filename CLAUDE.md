# visualization-bundle-examples — Claude Code Project Instructions

## Source Control Rule (READ FIRST)

**You only commit code on a feature branch you created from the latest
`main`, when the operator asks you to implement a feature task.** You
may push that feature branch to `origin` and open a pull request for
it. Everything else in source control stays operator-only.

This repo is a **public layer bundle** consumed by
`visualization-harness`, `midi-daddy`, and any future host that
implements the
[`visualization-layer-core`](https://github.com/rdgco/visualization-layer-core)
contract. Tags here become pin targets in downstream consumers, so
PR discipline matters:

- Tags are operator-only by default. Bumping `v0.x.y` is a deliberate
  release decision the operator makes after merging changes. Do not
  tag on your own initiative. When the operator explicitly delegates
  a specific tag — e.g., "tag and push v0.2.1" right after merging a
  bundle PR — create the annotated tag on the merge commit of `main`
  and push it. Stick to the exact name and commit the operator
  specified; never freelance a different name, retag, or modify
  existing tags.
- Never amend, force-push, or rewrite published history.

### Allowed (when implementing a task)

- `git checkout main` + `git pull --ff-only origin main` to sync.
  Use freely — both before branching for a new task and as routine
  housekeeping. `--ff-only` is the safe form; if a fast-forward
  isn't possible, surface that to the operator rather than reaching
  for `--merge` or `--rebase`.
- `git switch -c feature/<slug>` from updated main.
- Work on the feature branch: `git add`, `git commit`, rebase against
  main if upstream moves.
- `git push -u origin feature/<slug>` then `gh pr create`.
- Tidy up merged local branches: `git branch --merged main` to see
  candidates, `git branch -d <branch>` to delete each one. The `-d`
  form refuses if the branch has unmerged work — that's the safety
  net; never use `-D` (force delete). If `-d` refuses, surface the
  branch + reason to the operator. Skip `main`, the currently-
  checked-out branch, and anything explicitly named as protected.

### Forbidden (always)

- Mutating `main` directly (commit, push, merge, rebase, reset).
- Force-push anywhere (`--force` / `--force-with-lease`).
- `gh pr merge` / `gh pr close` / `gh pr reopen`.
- Modifying existing tags. Tag creation is operator-only by default
  but allowed when the operator explicitly delegates a specific
  tag — see the bullet above.
- `git branch -D <branch>` (force delete). Use the safe `-d` form
  only — see the housekeeping bullet under "Allowed."
- Remote branch deletion (`git push origin --delete <branch>` or
  `git push origin :<branch>`). Remote cleanup is operator-only.
- `git config` mutations (global, system, or local).

## What this repo is

The canonical **public examples bundle** for the visualization-layer
ecosystem. A flat tree of layer directories that any harness or
consumer can install via:

```bash
visual-bundle install github:rdgco/visualization-bundle-examples#<tag>
```

Each layer lives at `layers/<name>/<name>-layer.js` (the contract
entry) plus any supporting files in that directory (`lib/`,
`README.md`, optional tests). No bundle manifest, no `package.json`,
no build step — the consumer's discovery scan walks `layers/*/` and
imports each entry directly.

## What this repo is NOT

- A library of machinery. The contract validator, layer-discovery
  walker, bundle install commands, and orbit camera helpers all live
  in `visualization-layer-core`. This repo ships only layer code.
- A consumer app. No renderer chrome, no panel UI, no compositor
  wiring — those live downstream.

## Authoring conventions

- **Contract conformance.** Every layer must satisfy
  `validateLayer()` from `visualization-layer-core/contract`. Missing
  `description`, missing `default-export class`, malformed `params`
  — install will reject the whole bundle if any layer fails
  validation. Run the validator locally before opening a PR.
- **Per-frame ctx.** The host runtime is allowed to swap canvases
  between frames (e.g., for opacity / chroma-key offscreen routing).
  Do NOT cache `ctx.canvas` or `ctx.ctx2d` in `init()` and use the
  cached refs in `render()`. Read `ctx` per frame from the
  parameter passed to `render(ctx, params, dt)`. See
  `layers/vibrations/vibrations-layer.test.js` for the regression
  test that locks this in.
- **No external runtime deps.** Layers ship as bundle-internal code
  only — no `node_modules`, no external imports beyond
  `visualization-layer-core` exports. A bundle that requires a
  separate dependency tree breaks the "install + go" UX.
- **Per-layer README.** Each `layers/<name>/` should have a
  `README.md` covering what the layer demonstrates, params worth
  knowing about, and how to run it in the harness. Mirror the
  existing `skyline` and `vibrations` patterns.

## Tasks and sessions

This repo doesn't have its own task tracking — feature requests and
bug reports live as GitHub issues here, or as cross-repo tasks in
midi-daddy / visualization-harness when the bundle change is driven
by a downstream need.
