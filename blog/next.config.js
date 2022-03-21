module.exports = {
    webpack: (config, { buildId, dev }) => {
      config.resolve.symlinks = true
      return config
    }
  }