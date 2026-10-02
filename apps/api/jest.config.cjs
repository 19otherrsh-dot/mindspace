/**
 * CommonJS (`.cjs`, not `.js`): this package is `"type": "module"`, so a `.js`
 * config is parsed as ESM and `module.exports` is undefined. A `.ts` config
 * would need `ts-node` installed and fails opaquely without it.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    // The source uses explicit .ts specifiers for native ESM; map them back to
    // the files on disk so Jest's resolver can find them.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^(\\.{1,2}/.*)\\.ts$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  // expo-server-sdk ships ESM only and must be transformed rather than skipped.
  transformIgnorePatterns: ['node_modules/(?!(expo-server-sdk)/)'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
};
