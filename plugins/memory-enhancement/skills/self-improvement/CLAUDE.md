# CLAUDE.md — memory-enhancement/skills/self-improvement

- `skills/self-improvement/SKILL.md`: on-demand retro skill, runs inline
  (no `context: fork` -- an isolated subagent has no session history to
  reflect on). Three steps: reflect on this session's own tool
  calls/reasoning against a fixed efficiency-retro prompt; report a
  concrete-bullet summary to the user (always, regardless of whether
  anything is saved); save durable, generalizable lessons as
  `feedback`-type memory via the auto-memory two-step save process,
  gated by a hard dedup check against `MEMORY.md` and its own running
  memory file (`feedback_self_improvement_efficiency.md`) so repeated
  runs don't accumulate near-duplicate entries. No hooks, no `userConfig`
  toggle -- unlike `dream`'s auto-nudge, this is a plain on-demand skill,
  consistent with this repo's precedent that on-demand skills aren't
  toggle-gated.
