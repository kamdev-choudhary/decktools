# Changesets

Each file in this folder describes one change to one or more decks: which
packages it touches, whether it is a patch, minor or major change, and a line
for the changelog. Add one with `pnpm changeset` in any pull request that
changes a published deck (`pgdeck`, `s3deck`, `redisdeck`).

The release workflow turns pending changesets into a "Version packages" pull
request (version bumps and `CHANGELOG.md` entries). Merging that pull request
publishes the new versions to npm. See the root README, "Releasing".
