# Contributing to mdpeek

Thanks for your interest in improving mdpeek! This is a small project, so the
process is lightweight.

## Development setup

**Prerequisites**

- [Node.js](https://nodejs.org/) 18+ (tested on v24)
- [Rust](https://rustup.rs/) stable (tested on 1.95)
- Windows 10/11 (WebView2 ships with the OS)

**Get started**

```bash
git clone https://github.com/sanketpatel32/mdpeek.git
cd mdpeek
npm install        # install JS dependencies
npm run tauri dev  # launch the app in dev mode (hot reload on JS changes)
```

The first `tauri dev` compile takes a few minutes (building ~370 Rust crates).
Subsequent rebuilds are fast.

## Project layout

```
src/lib/renderer.js     MD -> HTML pipeline (the tested core)
src/views/viewer.js     view mode: render + table of contents
src/views/editor.js     edit mode: split textarea + live preview
src/main.js             app wiring: open/save/toggle/theme, IPC, drag-drop
src/styles/             themes.css (tokens), base.css (layout), content.css (markdown)
src-tauri/src/          Rust backend: commands.rs (open/save), watcher.rs (live reload)
test/                   Vitest unit tests + fixtures
```

## Common tasks

| Task                      | Command                  |
| ------------------------- | ------------------------ |
| Run unit tests            | `npm test`               |
| Run tests in watch mode   | `npm run test:watch`     |
| Launch dev app            | `npm run tauri dev`      |
| Build production installer| `npm run tauri:build`    |

`npm run tauri:build` produces the installer in `releases/`.

## Making changes

1. Create a branch: `git switch -c my-feature`.
2. Make your changes. If you touch `src/lib/renderer.js`, add or update tests
   in `test/renderer.test.js` — this is the only module with automated tests,
   and it should stay covered.
3. Run `npm test` and make sure all tests pass.
4. Commit with a clear message (conventional commits style is appreciated,
   e.g. `feat: ...`, `fix: ...`, `docs: ...`).
5. Open a pull request.

## Regenerating app icons

The app icon lives at `icon.png` (project root). If you change it, regenerate
the platform icon set:

```bash
npm run tauri -- icon icon.png
```

## License

By contributing, you agree that your contributions are licensed under the MIT
License, same as the rest of the project.
