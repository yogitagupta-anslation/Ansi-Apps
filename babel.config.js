/**
 * Present for Jest's sake.
 *
 * Metro already applies `babel-preset-expo` whether or not this file exists, so adding
 * it changes nothing about how the app is bundled — but babel-jest has no such default
 * and will not transform JSX or TypeScript without being told.
 */
module.exports = function (api) {
  api.cache(true);
  return {presets: ['babel-preset-expo']};
};
