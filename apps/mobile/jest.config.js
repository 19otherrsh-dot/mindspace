/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Stated explicitly: the jest-expo preset defines per-platform projects, and
  // without a rootDir/testMatch of our own Jest resolves no roots at all and
  // reports "no files found" rather than an error.
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // React Native Testing Library 14 ships its matchers by default; the old
  // `extend-expect` entry point no longer exists and referencing it fails
  // config validation before any test runs.
  transformIgnorePatterns: [
    // Anything listed here is transformed rather than skipped. Packages that
    // ship untranspiled ESM (the Expo modules, @bittingz/expo-widgets,
    // react-native-iap) fail with "Cannot use import statement outside a
    // module" if they are left out.
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@bittingz/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|native-base|react-native-svg|react-native-iap|posthog-react-native|zustand)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
