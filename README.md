# brain-wiki-viz

The front end of `brain viz`, the map of a [brain-wiki](https://github.com/brain-wiki/brain-wiki)
brain: a WebGL map with semantic zoom (overview → group → topic → note) and a panel for
navigating, searching, and finding notes with issues. The design is in brain-wiki's
`docs/design/12-visualizer.md`.

brain-wiki ships the built bundle in `src/brainwiki/viz/app/`, so installing or running
brain-wiki never needs Node. This repository is only for people changing the visualizer.

## Develop

Clone it next to brain-wiki (`~/src/brain-wiki` and `~/src/brain-wiki-viz`, for example). It
needs Node 20.19 or newer (on Node 22, 22.12 or newer):

```sh
npm ci
npm run check          # type check, unit tests, lockfile check
npm run dev            # Vite dev server; /api is proxied to a running `brain viz`
```

For `npm run dev`, start `brain viz --port 8765 --no-open` in brain-wiki first and open the dev
server with the printed `?t=<token>`. Set `BRAIN_VIZ_BACKEND` to proxy elsewhere.

## Ship a change

```sh
npm run build          # writes ../brain-wiki/src/brainwiki/viz/app/
```

`build` also writes `THIRD_PARTY_NOTICES.txt` (licenses of every bundled package) and
`BUILD_INFO.json` (the commit it was built from) next to the bundle. Commit here first so
the build is stamped with a clean commit, then commit the bundle in brain-wiki.

Set `BRAIN_WIKI_APP_DIR` to build into a brain-wiki checkout somewhere other than the sibling
directory.

## Verify a bundle

```sh
npm run verify         # rebuild this checkout and compare with the bundle in brain-wiki
```

From brain-wiki, `scripts/check_viz.py --source <this checkout>` runs the same comparison.
CI should check out this repository at the commit in `BUILD_INFO.json` first, so the
committed bundle is proven to match reviewed source. `package-lock.json`
resolves from the public npm registry only (`npm run check` enforces it).

## License

Apache-2.0. Bundled packages are MIT or ISC; see `THIRD_PARTY_NOTICES.txt` in the build.
