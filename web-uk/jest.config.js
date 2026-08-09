module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  // Don't run the dev server during tests
  setupFilesAfterEnv: ['./tests/setup.js']
};
