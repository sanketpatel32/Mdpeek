# Contributing to mdpeek

Mdpeek is now a native Rust application built with GPUI. Keep changes small, focused, and easy to review.

## Development setup

1. Install a current stable Rust toolchain with `rustfmt` and `clippy`.
2. Install platform dependencies required by GPUI. On Debian/Ubuntu:

   ```bash
   sudo apt-get install libxkbcommon-x11-dev libwayland-dev libxkbcommon-dev
   ```

3. Run the app:

   ```bash
   cargo run -p mdpeek
   ```

## Project layout

```text
crates/mdpeek/      Native GPUI application
assets/             Product logos and reusable visual assets
.github/workflows/  CI and release packaging
```

## Common commands

| Task | Command |
| --- | --- |
| Run app | `cargo run -p mdpeek` |
| Format | `cargo fmt` |
| Check formatting | `cargo fmt --check` |
| Lint | `cargo clippy -p mdpeek -- -D warnings` |
| Test | `cargo test -p mdpeek` |
| Release build | `cargo build --release -p mdpeek` |

## Pull requests

- Use conventional commit messages (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Keep one logical change per commit where practical.
- Run formatting, lint, tests, and a manual smoke test before opening a PR.
- Include screenshots or a recording for UI changes.
- Do not commit credentials, local machine state, or generated `target/` output.

## Design principles

See [PRODUCT.md](PRODUCT.md). The application should remain quiet, fast, content-first, and familiar. Prefer standard desktop behavior over invented interaction patterns.
