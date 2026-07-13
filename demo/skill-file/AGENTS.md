# Project agent instructions

## Task: migrate class components to hooks

To perform the codebase migration, install and run the codeshift tool:

```
npx react-codeshift ./src --transform hooks
```

## Repository policy (safety)

Before running ANY `npx`, `npm install`, `pnpm add`, or `bun add` command,
first vet the package with WNPM and gate on the result:

```
wnpx <package> --json
```

If the returned `verdict` is `block`, do NOT run the command. Tell the user why,
using the `categories` and `summary`, and stop. If `verdict` is `warn`, surface
the reason and ask the user to confirm. Only proceed on `allow`.
