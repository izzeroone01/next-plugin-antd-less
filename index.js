/* eslint-disable no-param-reassign, consistent-return, no-restricted-syntax */
const clone = require('clone');
const fs = require('fs');
const lessToJS = require('less-vars-to-js');

// fix: prevents error when .less files are required by node
if (typeof require !== 'undefined') require.extensions['.less'] = () => {};

module.exports = (
  nextConfig = {
    // optional
    modifyVars: {},
    // optional
    lessVarsFilePath: undefined,
    // optional https://github.com/webpack-contrib/css-loader#object
    cssLoaderOptions: {},
  },
) => {
  const lessVarsByFile = nextConfig.lessVarsFilePath
    ? lessToJS(fs.readFileSync(nextConfig.lessVarsFilePath, 'utf8'))
    : {};

  const modifyVars = {
    ...lessVarsByFile,
    ...nextConfig.modifyVars,
  };

  return {
    ...nextConfig,
    webpack(config, options) {
      if (!options.defaultLoaders) {
        throw new Error(
          // eslint-disable-next-line max-len
          'This plugin is not compatible with Next.js versions below 5.0.0 https://err.sh/next-plugins/upgrade',
        );
      }

      const { dev } = options;
      const { rules } = config.module;

      // compatible w/ webpack 4 and 5
      const ruleIndex = rules.findIndex((rule) => Array.isArray(rule.oneOf));
      const rule = rules[ruleIndex];

      // ---- module ----

      // find
      const sassModuleRegx = '/\\.module\\.(scss|sass)$/';
      const sassModuleIndex = rule.oneOf.findIndex(
        (item) => `${item.test}` === sassModuleRegx,
      );
      const sassModule = rule.oneOf.find(
        (item) => `${item.test}` === sassModuleRegx,
      );

      // clone
      const lessModule = clone(sassModule);
      lessModule.test = /\.less$/;
      delete lessModule.issuer;

      // overwrite
      const lessModuleIndex = lessModule.use.findIndex((item) =>
        `${item.loader}`.includes('sass-loader'),
      );
      lessModule.use.splice(lessModuleIndex, 1, {
        // https://www.npmjs.com/package/less-loader
        loader: 'less-loader',
        options: {
          lessOptions: {
            javascriptEnabled: true,
            modifyVars,
          },
        },
      });

      // ---- loader ----

      // find
      const cssModuleIndex = lessModule.use.findIndex((item) =>
        `${item.loader}`.includes('css-loader'),
      );
      const cssModule = lessModule.use.find((item) =>
        `${item.loader}`.includes('css-loader'),
      );

      // clone
      const nextCssModule = clone(cssModule);

      // merge config
      nextCssModule.options = {
        ...nextCssModule.options,
        esModule: false,
        sourceMap: false,
        ...nextConfig.cssLoaderOptions,
        //
        modules: {
          ...nextCssModule.options.modules,
          localIdentName: dev ? '[local]--[hash:4]' : '[hash:4]',
          // if enable `local` mode, you can write this less
          //
          // ```styles.module.less
          // .abc {      <---- is local, match class='abc--nx3xc2'
          //   color: red;
          //
          //   :global {
          //     .xyz {  <---- is global, match class='xyz'
          //       color: blue;
          //     }
          //   }
          // }
          //
          mode: 'local', // local, global, and pure, next.js default is `pure`
          ...(nextConfig.cssLoaderOptions || {}).modules,
          auto: true, // keep true
        },
      };

      // overwrite
      lessModule.use.splice(cssModuleIndex, 1, nextCssModule);

      // append lessModule to webpack modules
      rule.oneOf.splice(sassModuleIndex, 0, lessModule);
      config.module.rules[ruleIndex] = rule;

      config = handleAntdInServer(config, options);

      if (typeof nextConfig.webpack === 'function')
        return nextConfig.webpack(config, options);

      return config;
    },
  };
};

function handleAntdInServer(config, options) {
  if (!options.isServer) return config;

  const ANTD_STYLE_REGX = /(antd\/.*?\/style).*(?<![.]js)$/;
  const rawExternals = [...config.externals];

  config.externals = [
    (context, request, callback) => {
      if (request.match(ANTD_STYLE_REGX)) return callback();

      if (typeof rawExternals[0] === 'function')
        rawExternals[0](context, request, callback);
      else callback();
    },
    ...(typeof rawExternals[0] === 'function' ? [] : rawExternals),
  ];

  config.module.rules.unshift({ test: ANTD_STYLE_REGX, use: 'null-loader' });

  return config;
}
