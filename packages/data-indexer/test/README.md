# Data Indexer Tests

This folder is reserved for package-local unit and fixture tests.

Recommended structure:

```text
test/
  fixtures/
    cloud/
    repositories/
  unit/
  integration/
```

The package `test` script currently runs `typecheck` as the minimum OSS quality gate. Add a package-local Jest or Vitest config before introducing executable `.test.ts` files so contributors can run this package independently.

