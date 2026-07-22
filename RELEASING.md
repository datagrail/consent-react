# Releasing

`@datagrail/react-native-consent` publishes to the public npm registry from a
tag push. The [`Publish` workflow](.github/workflows/publish.yml) builds, tests,
and runs `npm publish --provenance --access public` whenever a `v*` tag lands on
`main`.

## Prerequisites (one-time)

- **Repo is public.** `npm publish --provenance` attests the build against a
  public source repo; provenance won't verify from a private repo.
- **`NPM_TOKEN` secret** exists in the repo settings — an npm automation token
  with publish rights to the `@datagrail` org.
- You have push access to `main` and permission to push tags.

## Cutting a release

1. Make sure `main` is green and has everything you want to ship.
2. Bump the version in `package.json` (see Versioning below) on a branch, open a
   PR, and merge it to `main`.
3. From an up-to-date `main`, create and push the tag matching that version:
   ```bash
   git checkout main && git pull
   git tag v0.1.0-alpha.1        # must match package.json "version", prefixed with v
   git push origin v0.1.0-alpha.1
   ```
4. Watch the `Publish` workflow in the Actions tab. On success the version is
   live on npm.
5. Confirm: `npm view @datagrail/react-native-consent version`.

> The tag drives the release, but npm publishes whatever `version` is in
> `package.json` at that commit. Keep the tag and `package.json` version in
> sync (`vX.Y.Z` ↔ `X.Y.Z`), or the published version won't match the tag.

## Versioning

Semver. Pre-1.0 the API may still shift, so:

- **`0.x.y` → `0.x.(y+1)`** — fixes and backward-compatible changes.
- **`0.x` → `0.(x+1)`** — breaking changes (allowed pre-1.0).
- **Pre-releases** — `0.1.0-alpha.N` / `-beta.N` / `-rc.N` publish under the
  `next`-style dist-tag semantics npm applies to any version with a hyphen, so
  they won't become the default `latest` install. Promote to a stable `0.1.0`
  when ready.

## What ships

The published tarball is the library only — `src/`, built `lib/`, native
`ios/` and `android/src/`, the Expo plugin, the podspec, `README.md`, and
`LICENSE`. The `test-client/` app and `android/build` artifacts are excluded via
the `files` allowlist in `package.json`. Verify before tagging with:

```bash
npm pack --dry-run
```

## If a publish fails

- **Version already exists** — npm rejects re-publishing the same version. Bump
  and tag again; never force.
- **Provenance error** — confirm the repo is public and the workflow has
  `id-token: write` permission (it does).
- **Auth / 403** — check the `NPM_TOKEN` secret and its org publish rights.
