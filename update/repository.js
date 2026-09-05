// The public GitHub repository SYNSA updates from, and reads its changelog
// from. One constant, two consumers: update/productionProvider.js (the update
// feed) and server.js (the changelog on the welcome screen).
//
// Deliberately NOT read from package.json's build.publish block, even though
// that is where electron-builder itself takes it from at build time:
// electron-builder strips the whole "build" section out of the package.json
// it packs into the app, so that lookup works in a dev run and returns
// undefined in the installed program — which is exactly how the welcome
// screen ended up showing an empty changelog after 0.1.6.
module.exports = { owner: 'SynAisa', repo: 'SYNSA' };
