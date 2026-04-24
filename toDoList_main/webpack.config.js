const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const FaviconsWebpackPlugin = require('favicons-webpack-plugin');
const { InjectManifest } = require('workbox-webpack-plugin');

module.exports = {
  mode: "development",
  entry: {
    index: './src/index.js',
    main: './src/main.js',
    toDo: './src/toDo.js',
    list: './src/listLogic.js',
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'Task Management',
      template: './src/template.html',
    }),
    new FaviconsWebpackPlugin({
      logo: './src/favicon.svg',
      mode: 'webapp',
      devMode: 'light',
      inject: false,
      prefix: 'assets/',
      favicons: {
        appName: 'Task Management',
        appShortName: 'Tasks',
        background: '#0e0f14',
        theme_color: '#0e0f14',
        icons: {
          android: true,
          appleIcon: true,
          appleStartup: false,
          favicons: false,
          windows: false,
          yandex: false,
        },
      },
    }),
    new InjectManifest({
      swSrc: './src/sw.js',
      swDest: 'sw.js',
      exclude: [/\.map$/, /^manifest.*\.js$/, /\.LICENSE\.txt$/],
    }),
  ],
  output: {
    filename: '[name]bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    publicPath: 'auto',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          }
        }
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.webmanifest$/i,
        type: 'asset/resource',
        generator: { filename: 'manifest.webmanifest' },
      },
      {
        test: /favicon\.svg$/i,
        type: 'asset/resource',
        generator: { filename: 'favicon.svg' },
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
        exclude: /favicon\.svg$/i,
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },

};
