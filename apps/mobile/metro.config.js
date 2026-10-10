const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Ortak paket (kaynak TS) monorepo içinde, uygulama kökünün dışında durur.
const core = path.resolve(__dirname, '../../packages/core');
config.watchFolders = [...(config.watchFolders ?? []), core];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.extraNodeModules = { '@retfast/core': core };

module.exports = config;
