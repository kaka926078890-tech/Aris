module.exports = {
  appId: 'com.aris.desktop',
  productName: 'Aris',
  directories: { output: 'dist' },
  files: [
    'electron.main.js',
    'preload.js',
    'src/**/*',
    '!src/renderer/main.js',
    '!src/**/*.map',
  ],
  extraResources: [],
  mac: {
    category: 'public.app-category.utilities',
    target: ['dmg', 'zip'],
  },
  win: {
    target: ['nsis'],
  },
};
