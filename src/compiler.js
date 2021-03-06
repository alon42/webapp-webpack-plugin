const path = require('path');
const msgpack = require('msgpack-lite');
const findCacheDir = require('find-cache-dir');
const { AsyncSeriesWaterfallHook } = require('tapable');
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');
const { getAssetPath, trigger } = require('./compat');

const wwp = 'webapp-webpack-plugin';

module.exports.run = ({ prefix, favicons: options, logo, cache, publicPath: publicPathOption, outputPath }, context, compilation) => {
  // The entry file is just an empty helper
  const filename = '[hash]';
  const publicPath = publicPathOption || compilation.outputOptions.publicPath || '/';

  // Create an additional child compiler which takes the template
  // and turns it into an Node.JS html factory.
  // This allows us to use loaders during the compilation
  const compiler = compilation.createChildCompiler(wwp, { filename, publicPath });
  compiler.context = context;

  const loader = `!${require.resolve('./loader')}?${JSON.stringify({ prefix, options, path: publicPath, outputPath })}`;

  const cacheDirectory = cache && (
    (typeof cache === 'string')
      ? path.resolve(context, cache)
      : findCacheDir({ name: wwp, cwd: context }) || path.resolve(context, '.wwp-cache')
  );

  const cacher = cacheDirectory
    ? `!${require.resolve('cache-loader')}?${JSON.stringify({ cacheDirectory })}`
    : ''
    ;

  new SingleEntryPlugin(context, `!${cacher}${loader}!${logo}`, path.basename(logo)).apply(compiler);

  if (compilation.hooks) {
    compilation.hooks.webappWebpackPluginBeforeEmit = new AsyncSeriesWaterfallHook(['result']);
  }

  // Compile and return a promise
  return new Promise((resolve, reject) => {
    compiler.runAsChild((err, [chunk] = [], { hash, errors = [], assets = {} } = {}) => {
      if (err || errors.length) {
        return reject(err || errors[0].error);
      }

      // Replace [hash] placeholders in filename
      const output = getAssetPath(compilation, filename, { hash, chunk });
      const result = msgpack.decode(Buffer.from(eval(assets[output].source()), 'base64'));

      delete compilation.assets[output];

      trigger(compilation, 'webapp-webpack-plugin-before-emit', result, (error, { tags = [], assets = [] } = {}) => {
        if (error) {
          return reject(error);
        }

        for (const { name, contents } of assets) {
          compilation.assets[name] = {
            source: () => contents,
            size: () => contents.length,
          };
        }

        return resolve(tags);
      });
    });
  });
};
