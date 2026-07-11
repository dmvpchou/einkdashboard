# Repository Instructions

## Commits

Follow the workflow and conventions from
[maylogger/lazy-commit](https://github.com/maylogger/lazy-commit):

- Inspect the complete working tree before staging.
- Group changes by intent, not merely by file location.
- Create atomic commits that do one thing, are independently understandable,
  and can be reverted on their own.
- Use hunk or patch staging when one file contains unrelated changes.
- Do not mix features, fixes, styling, tests, and documentation unless they are
  inseparable parts of the same behavior.
- Use Conventional Commits: `<type>(optional scope): <description>`.
- Write `type` and `scope` in English.
- Write the description in Traditional Chinese without a trailing period.
- Before committing, run the checks relevant to each staged change and inspect
  the staged diff.
- After committing, report each commit hash, purpose, and file scope.
