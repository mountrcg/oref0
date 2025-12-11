const path = require('path');
const TerserPlugin = require("terser-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  mode: 'production',
  entry: {
    iob: './lib/iob/index.js',
    meal: './lib/meal/index.js',
    "determineBasal": './lib/determine-basal/determine-basal.js',
    "glucoseGetLast": './lib/glucose-get-last.js',
    "basalSetTemp": './lib/basal-set-temp.js',
    autosens: './lib/determine-basal/autosens.js',
    profile: './lib/profile/index.js',
    "autotunePrep": './lib/autotune-prep/index.js',
    "autotuneCore": './lib/autotune/index.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'var',
    library: 'trio_[name]'
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'dist/iob.js', to: 'bundle/iob.js' },
        { from: 'dist/meal.js', to: 'bundle/meal.js' },
        { from: 'dist/determineBasal.js', to: 'bundle/determine-basal.js' },
        { from: 'dist/glucoseGetLast.js', to: 'bundle/glucose-get-last.js' },
        { from: 'dist/basalSetTemp.js', to: 'bundle/basal-set-temp.js' },
        { from: 'dist/autosens.js', to: 'bundle/autosens.js' },
        { from: 'dist/profile.js', to: 'bundle/profile.js' },
        { from: 'dist/autotunePrep.js', to: 'bundle/autotune-prep.js' },
        { from: 'dist/autotuneCore.js', to: 'bundle/autotune-core.js' }
      ]
    })
  ],
};
