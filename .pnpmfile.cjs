// pnpm hooks for the whole workspace.
module.exports = {
  hooks: {
    /**
     * The internal @deck/* packages are inlined into each tool's bundle and are
     * never published, so drop them from the manifest that goes to npm.
     */
    beforePacking(pkg) {
      for (const field of ['dependencies', 'devDependencies']) {
        for (const name of Object.keys(pkg[field] ?? {})) {
          if (name.startsWith('@deck/')) delete pkg[field][name];
        }
      }
      return pkg;
    },
  },
};
