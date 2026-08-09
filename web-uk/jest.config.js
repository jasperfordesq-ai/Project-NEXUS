// Date-label assertions model the Irish Web UK deployment, regardless of the
// operating-system timezone used by the developer machine or CI runner. Set
// this before Jest creates workers so their ICU state is deterministic.
process.env.TZ = 'Europe/Dublin';

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
