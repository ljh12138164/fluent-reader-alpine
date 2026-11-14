# Private end-to-end tests

The optional `e2e` submodule is maintained in the private
`yang991178/fluent-reader-tests` repository. Normal installs, builds, and release
workflows do not need it. Recursive clones require access to that repository.

From the application repository root:

```sh
git submodule update --init tests/e2e
pnpm install --frozen-lockfile
pnpm build
pnpm --dir tests/e2e import
pnpm --dir tests/e2e install --frozen-lockfile
pnpm --dir tests/e2e test
```

See `tests/e2e/README.md` for the harness architecture and diagnostics. Commit
and push test changes in the private repository before publishing an updated
submodule pointer here. Never add test sources or reports directly to this
public repository.
