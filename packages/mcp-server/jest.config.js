/**
 * Jest configuration for @thinkingos/vsl-mcp-server package.
 *
 * Uses ts-jest for TypeScript support with ESM modules.
 * ESM format (.js + "type": "module" in package.json) — no ts-node required.
 */

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@thinkingos/vsl-sdk$': '<rootDir>/../../dist/index.mjs',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts'],
};

export default config;