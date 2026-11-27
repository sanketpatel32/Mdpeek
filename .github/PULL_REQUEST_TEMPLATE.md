## Summary

<!-- One short paragraph: what does this PR do and why? -->

Closes #<issue number> _(if applicable)_

## Type of change

- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Documentation (`docs:`)
- [ ] Refactor / cleanup (`refactor:`)
- [ ] Test-only (`test:`)

## How to test

<!-- Steps a reviewer can follow in the native app, or a note if covered by tests. -->

## Screenshots or recording

<!-- Required for UI changes — before/after if possible. Delete otherwise. -->

| Before | After |
| ------ | ----- |
|        |       |

## Checklist

- [ ] `cargo fmt --check` passes locally
- [ ] `cargo clippy -p mdpeek -- -D warnings` passes locally
- [ ] `cargo test -p mdpeek` passes locally
- [ ] New/changed behavior is covered by tests (or explained why not)
- [ ] Manually smoke-tested with `cargo run -p mdpeek`
- [ ] Commit messages follow conventional commits (`feat:`, `fix:`, `docs:` …)
