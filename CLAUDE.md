# CLAUDE.md

## Verification

After creating or modifying any file, run all checks before declaring done:

```
pnpm run check && pnpm run knip
```

`check` covers: lint, format, tests, build.
`knip` catches unused exports and dead dependencies.

Do not claim done without these passing.
