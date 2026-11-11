# Desktop builds and releases

The **Desktop builds** workflow builds Windows x64 (NSIS and portable EXE), Linux x64 (DEB and AppImage), and macOS ARM64 (APP and DMG) in parallel. The Mac job reuses `.github/workflows/macos.yml`; it also remains available on its own. No Intel Mac build is produced.

## Publish in one build

Starting with 0.0.7, the preferred release path is:

1. Synchronize `package.json`, `package-lock.json`, workspace `Cargo.toml`, the two workspace packages in `Cargo.lock`, and `src-tauri/tauri.conf.json`. Add curated notes in `scripts/release/notes.json`.
2. Commit and push the sources to `main`.
3. Open **Actions → Desktop builds → Run workflow**, choose `main`, and enter the matching tag (for example `v0.0.7`) in `release_tag`.

Or use:

```sh
gh workflow run build.yml --ref main --field release_tag=v0.0.7
```

This single run builds all platforms on the default branch, which also refreshes the caches that future version tags can restore. Only after all three platform jobs succeed and their bundles are verified does the release job create the version tag and publish the assets. Existing tags must point at that exact source commit; they are never moved. The tag is created with the workflow's `GITHUB_TOKEN`, so its push does not trigger a duplicate build.

A direct push of a new `v*` tag still builds and publishes automatically. Ordinary pushes to `main` no longer launch a second matrix. A manual run with an empty `release_tag` creates Actions artifacts and refreshes default-branch caches without publishing. Pull requests still compile the platform bundles without publication.

## Fast build policy

The packaging workflows no longer execute `npm test`, `cargo test`, formatting checks or the WebKit browser suite. This avoids compiling debug test executables and then compiling the application again in release mode on every platform. Tests remain in the repository and can be run explicitly during development:

```sh
npm test
cargo test -p ochat-core --locked
cargo fmt --all -- --check
```

Release builds retain the existing optimized production profile, thin LTO, encrypted storage/transport implementation, and compiler failure handling. Faster CI does not change runtime processing or security settings.

The mandatory release checks are:

- Matching versions/tag before compilation.
- Integrity verification of the documented vendored GLib security patch.
- Successful native compilation and bundling for all three platforms.
- ARM64 architecture, ad-hoc signature and DMG verification on macOS.
- Exact expected asset names, nonempty regular files, source-commit/tag identity and SHA-256 checks before/after publication.

## Caches and parallelism

All platforms retain Rust dependency caches and optional sccache with its bounded outage fallback. Workspace artifacts are now included in the Rust cache as well. Native compilation uses available CPU cores, capped at four jobs and roughly one job per 2.5 GiB of RAM; this allows more than one job on smaller runners without unbounded parallelism. Windows installer tools remain cached and transient download failures retry bundling without recompiling the application. Already-compressed installers are uploaded to Actions with compression level zero.

The first run with changed dependencies, toolchains or cache inputs may still be slower. Caches reduce repeated work; they cannot eliminate compilation of changed code or final linking. No fixed build-time guarantee is made. GitHub permits default-branch caches to be restored by version tags, whereas unrelated tag caches cannot be reused across tags; this is why a manual publication on `main` is preferred.

References: [GitHub cache scope rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache), [Rust cache options](https://github.com/Swatinem/rust-cache), [GITHUB_TOKEN workflow triggering behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

## Publication recovery

If packaging succeeded but publication failed, use **Resume verified release publication** with the version tag and the successful Desktop builds run ID. It verifies the original workflow, source commit and successful Windows/Linux/Mac ARM64 jobs, then downloads those existing artifacts instead of compiling again. If failure occurred before the tag was created, re-run the failed release job of the original manual publication first.

Publication keeps the draft release ID returned by GitHub and uses it for uploads/finalization. It checks every asset hash and never silently replaces an already published asset with different bytes. Ad-hoc macOS signing is not notarization.

## Diagnostics

Build and packaging logs remain available as platform log artifacts. The release publisher preserves its source/version/hash checks. The transfer-snapshot, offline ordering, account recovery, voice-message deletion and GUI tests remain available locally; they are no longer automatic packaging prerequisites.
