# claude-plugins

Claude Code plugin marketplace scaffold.

## Repository structure

- `marketplace/manifests/marketplace.json` - Marketplace index manifest.
- `marketplace/manifests/plugins/` - Individual plugin manifests.
- `marketplace/config/release.json` - Release packaging config.
- `.github/workflows/ci.yml` - CI validation for manifests/config.
- `.github/workflows/release.yml` - Tag-based release workflow.

## CI-based release flow

1. Open a PR or push to `main` to run JSON and manifest reference validation.
2. Tag a commit as `v*` (for example `v1.0.0`) to trigger release packaging and GitHub Release publishing.
