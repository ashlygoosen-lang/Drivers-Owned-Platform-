module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // No logs in release builds (MASVS-CODE): strip console.* except errors.
    env: { production: { plugins: [['transform-remove-console', { exclude: ['error'] }]] } },
  };
};
