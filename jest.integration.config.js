module.exports = {
  preset: 'react-native',
  testMatch: ['<rootDir>/__integration__/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/lib/', '<rootDir>/test-client/'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-mmkv)/)',
  ],
};
