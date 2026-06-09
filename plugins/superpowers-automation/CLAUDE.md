# superpowers-automation

Hook plugin. Two PostToolUse Write hooks, individually toggled via userConfig (both default false — intentional opt-in design, unlike the standard fail-open default).

- `hook_plans` — inject subagent guidance when writing `docs/superpowers/plans/*.md`
- `hook_specs` — inject spec-confirmed message when writing `docs/superpowers/specs/*.md`
- `configure-superpowers-automation` skill — settings wizard, always available (no userConfig toggle)
