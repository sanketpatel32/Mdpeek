# Contributing to mdpeek

Thanks for your interest in improving mdpeek! This is a small project, so the
process is lightweight.

> ⭐ **If you like mdpeek, please [star the repo](https://github.com/sanketpatel32/Mdpeek)** —
> it genuinely helps other people find the project.

## Before you start

- **No need to ask to be assigned.** If an issue is open and nobody has a PR
  linked to it, just start working on it and open a pull request when ready.
- Issues labeled [`good first issue`](https://github.com/sanketpatel32/Mdpeek/labels/good%20first%20issue),
  [`beginner friendly`](https://github.com/sanketpatel32/Mdpeek/labels/beginner%20friendly)
  or [`help wanted`](https://github.com/sanketpatel32/Mdpeek/labels/help%20wanted)
  are ready for anyone to pick up.
- If you find a bug or have an idea that isn't tracked yet, open an issue first
  so we can agree on the approach before you spend time on it.

## Development setup

**Prerequisites**

- [Node.js](https://nodejs.org/) 18+ (tested on v24)
- [Rust](https://rustup.rs/) stable (tested on 1.95)
- Windows 10/11 (WebView2 ships with the OS)

**Get started**

```bash
git clone https://github.com/sanketpatel32/Mdpeek.git
cd Mdpeek
npm install        # install JS dependencies
npm run tauri dev  # launch the app in dev mode (hot reload on JS changes)
```

The first `tauri dev` compile takes a few minutes (building ~370 Rust crates).
Subsequent rebuilds are fast.

## Project layout

```
src/main.js             app wiring: tabs, settings, themes, IPC, command palette
src/lib/                feature modules (renderer, graph, flashcards, drawing, …)
src/views/              editors & viewers (editor, viewer, pdf, terminal, file-tree, …)
src/styles/             themes.css (design tokens), base.css, content.css, reader.css, motion.css
src-tauri/src/          Rust backend: commands (open/save), file watcher
test/                   Vitest unit tests + fixtures
```

The Markdown → HTML pipeline in `src/lib/renderer.js` is the tested core —
if you touch it (or any other `src/lib/` module), add or update the matching
test in `test/`.

## Common tasks

| Task                       | Command                  |
| -------------------------- | ------------------------ |
| Run unit tests             | `npm test`               |
| Run tests in watch mode    | `npm run test:watch`     |
| Launch dev app             | `npm run tauri dev`      |
| Web-only dev server        | `npm run dev`            |
| Build production installer | `npm run tauri:build`    |

`npm run tauri:build` produces the installer in `releases/`.

## Making changes

1. Create a branch: `git switch -c my-feature`.
2. Make your changes. Keep PRs small and focused — one fix or feature per PR.
3. Run `npm test` and make sure all tests pass.
4. Commit with a clear message, conventional-commits style:
   `feat: …`, `fix: …`, `docs: …`, `refactor: …`, `test: …`, `chore: …`.
5. Open a pull request. The PR template will ask for a short summary, the
   issue it closes (`Closes #123`), and a checklist (tests, screenshots for
   UI changes, manual smoke test in the app).

## Pull request format

Every PR should include:

- **What & why** — one short paragraph a reviewer can understand without
  reading the diff.
- **Linked issue** — `Closes #<number>` when there is one.
- **Proof** — `npm test` passing; for UI changes, a before/after screenshot.
- A title matching the commit style, e.g. `fix: gutter drifts after zoom`.

## Regenerating app icons

The app icon lives at `icon.png` (project root). If you change it, regenerate
the platform icon set:

```bash
npm run tauri -- icon icon.png
```

## License

By contributing, you agree that your contributions are licensed under the MIT
License, same as the rest of the project.
