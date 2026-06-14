/** @type {import('jest').Config} */

const tsJestConfig = {
  tsconfig: './tsconfig.test.json',
  // Skip type-checking — tsc --noEmit handles that separately.
  // isolatedModules compiles each file independently without cross-file type resolution.
  diagnostics: false,
  isolatedModules: true,
};

module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  projects: [
    {
      // Fast unit tests — small import graphs, compiled in parallel workers
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: [
        '**/__tests__/**/*.test.ts',
        '!**/__tests__/task/task.test.ts',
      ],
      moduleFileExtensions: ['ts', 'js', 'json'],
      globals: { 'ts-jest': tsJestConfig },
    },
    {
      // Task tests — the Task import graph is very large (tools/index → MCP → all tools).
      // We redirect source imports to the pre-built dist/ so ts-jest only needs to
      // compile the test file itself, not the full 90-file transitive dependency tree.
      displayName: 'task',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/task/task.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      globals: { 'ts-jest': tsJestConfig },
      moduleNameMapper: {
        // Redirect production source imports to the compiled output.
        // The test file's own TypeScript is still compiled by ts-jest;
        // only the production module tree is served from pre-built JS.
        '^(\\.\\./)+task/task$': '<rootDir>/dist/task/task.js',
        '^(\\.\\./)+llm$': '<rootDir>/dist/llm/index.js',
        '^(\\.\\./)+llm/(.*)$': '<rootDir>/dist/llm/$2',
        '^(\\.\\./)+tools/types$': '<rootDir>/dist/tools/types.js',
        '^(\\.\\./)+tools/(.*)$': '<rootDir>/dist/tools/$2',
        '^(\\.\\./)+task/types$': '<rootDir>/dist/task/types.js',
        '^(\\.\\./)+context/(.*)$': '<rootDir>/dist/context/$2',
      },
    },
  ],
};
