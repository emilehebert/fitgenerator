/*
 * @title Webpack Config
 */

// Dependencies
import webpack from 'webpack';

// Config
import { paths } from './config.js';

//import path from 'path';

// Plugins
import SVGSpritemapPlugin from 'svg-spritemap-webpack-plugin';

const webpackConfig = {
  mode: process.env.NODE_ENV ? 'production' : 'development',

  entry: {
    main: paths.scripts.src,
  },
  output: {
    filename: '[name].js',
    // Morceaux chargés plus tard (Uploader, Supabase...): nom unique par version,
    // sinon le navigateur peut garder l'ancien en cache après une mise à jour
    chunkFilename: '[name].[contenthash:8].js',
  },

  module: {
    rules: [],
  },

  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    new SVGSpritemapPlugin(paths.assets.icons, {
      output: {
        filename: `../assets/icons.svg`,
        svgo: {
          plugins: [
            'removeTitle',
            { name: 'removeAttrs', params: { attrs: '(stroke|fill)' } },
          ],
        },
      },
      sprite: {
        prefix: 'icon-',
      },
      styles: {
        keepAttributes: false,
      },
    }),
  ],
};

if (process.env.NODE_ENV === 'production') {
  // console.log('Welcome to production');
  //webpackConfig.devtool = "source-map";
}
if (process.env.NODE_ENV === 'development') {
  // console.log('Welcome to development');
  webpackConfig.devtool = 'source-map';
}

export default webpackConfig;

