const path = require('path');
const LodashModuleReplacementPlugin = require('lodash-webpack-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const __DEV__ = process.env.NODE_ENV !== 'production';

const webpackConfig = {
  entry: './src/index.js',
  mode: __DEV__ ? 'development' : 'production',
  output: {
    path: path.resolve(__dirname, 'dist/'),
    filename: 'kawax.js',
    library: 'kawax-js',
    libraryTarget: 'umd',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules)/,
        loader: 'babel-loader',
      }
    ]
  },
  node: {
    net: 'empty',
    fs: 'empty',
    tls: 'empty'
  },
  plugins: []
};

if (__DEV__) {
  webpackConfig.plugins.push(new BundleAnalyzerPlugin());
}

if (!__DEV__) {
  webpackConfig.plugins.push(new LodashModuleReplacementPlugin());
}

module.exports = webpackConfig;
