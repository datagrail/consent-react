# Releasing

`@datagrail.io/react-native-consent` publishes to the public npm registry
**automatically on every qualifying merge to `main`** — there is no manual
`npm publish` and no version bump to make by hand.

[semantic-release](https://semantic-release.gitbook.io/) reads the Conventional
Commit messages since the last release, decides the next version, and (via the
[`Release` workflow](.github/workflows/release.yml)) publishes to npm with
provenance, creates the `vX.Y.Z` git tag, and cuts a GitHub Release with
generated notes. **GitHub Releases are the canonical changelog** (there is no
committed `CHANGELOG.md`).

Authentication is **OIDC Trusted Publishing** — GitHub Actions mints a
short-lived token at publish time. There is **no `NPM_TOKEN`** stored anywhere.

## How a release happens

1. Open a PR. Its **title must be a Conventional Commit** — the `PR Title` check
   ([`pr-title.yml`](.github/workflows/pr-title.yml)) enforces this.
2. Merge it. The repo is **squash-merge only**, so the squashed commit message
   is exactly the (validated) PR title.
3. The `Release` workflow runs on the push to `main`, and semantic-release maps
   the commit type to a version bump:

   | Commit type                                                   | Release |
   | ------------------------------------------------------------- | ------- |
   | `fix:`                                                        | patch   |
   | `feat:`                                                       | minor   |
   | `feat!:` / `fix!:` / `BREAKING CHANGE:`                       | major   |
   | `chore:` `ci:` `docs:` `refactor:` `test:` `style:` `perf:`\* | none    |

   \* `perf:` is patch under the default preset; the others do not release.

4. If the commits since the last release warrant a version, it publishes to npm
   (with a provenance badge), tags `vX.Y.Z`, and creates the GitHub Release.
   If nothing warrants a release, the workflow succeeds and does nothing.

Confirm after a release: `npm view @datagrail.io/react-native-consent version`.

## Versioning

Semver, derived entirely from commit types (table above). To force a specific
bump, write the commit/PR title accordingly (e.g. a breaking change needs
`feat!:` or a `BREAKING CHANGE:` footer). The `version` field in `package.json`
is **decorative** — semantic-release sets the real version in the CI workspace
at publish time and does not commit it back to `main`.

## One-time setup (already done — for reference)

- **Trusted publisher** configured on npmjs.com → `@datagrail.io/react-native-consent`
  → Settings → Trusted Publisher → GitHub Actions: org `datagrail`, repo
  `consent-react`, workflow `release.yml`. This is what makes tokenless OIDC
  publishing work; a brand-new package can't be pre-trusted, which is why…
- **`1.0.0` was a manual bootstrap publish** (local `npm publish`, no provenance
  on that one release), tagged `v1.0.0` as semantic-release's baseline. Every
  version after it is automatic.
- **Repo is public** — provenance attests the build against a public source repo.
- **Squash-merge only** with the PR title as the commit message (repo settings).

## What ships

The published tarball is the library only — `src/`, built `lib/`, native `ios/`
and the `android/` module (Kotlin under `android/src/` plus
`android/build.gradle.kts`), the built Expo plugin (`expo-plugin/build/`), the
podspec, `README.md`, and `LICENSE`. The `test-client/` app and
`android/build` / `.gradle` / `.cxx` artifacts are excluded via the `files`
allowlist in `package.json`. The `Release` workflow runs `npm run build:all`
(library + Expo plugin) before publishing, so both `lib/` and
`expo-plugin/build/` are always populated in the tarball.

## If a release fails

- **Nothing published, workflow green** — no releasable commits since the last
  release (only `chore:`/`docs:`/etc.). Expected; not an error.
- **Provenance / OIDC error** — confirm the workflow has `id-token: write` (it
  does) and that the npmjs.com trusted publisher matches this repo + `release.yml`.
- **`npm ci` engine warnings on the Node 18/20 CI jobs** — expected;
  semantic-release requires Node 22 and only runs in the `Release` job (Node 22).
  The warnings are non-fatal.
