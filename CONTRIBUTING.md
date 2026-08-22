# Contributing

Welcome! We appreciate your help in improving this plugin.

## Development

### Getting Started

Before contributing, please securely install the local Git hooks which enforce commit message formatting and other standards:

```bash
./scripts/setup-hooks
```

### Windows Users

If you are developing on a Windows machine, please run the dedicated batch script:

```cmd
.\scripts\setup-hooks.cmd
```

### Development Commands

```bash
# Run the standard test suite
npm run test

# Check formatting and run ESLint
npm run format:check
npm run lint

# Generate JSDoc documentation
npm run docs
```

## Release Process

This package uses [`@mikinho/autover`](https://github.com/yammm/ynode-autover) for automated versioning and changelog generation.

To release a new version seamlessly:

1. Make your code changes in a branch.
2. Open a Pull Request against `main`.
3. Add the **`autover-apply`** label to the Pull Request.
4. Merge the Pull Request.

Upon merge, the GitHub Action runner will automatically bump the package version, update the `CHANGELOG.md`, and commit the release directly to `main`. Tag creation is intentionally disabled in the checked-in workflow.

> **Note:** Direct commits to `main` are supported but will gracefully skip the `autover` pipeline to prevent versioning collisions.
