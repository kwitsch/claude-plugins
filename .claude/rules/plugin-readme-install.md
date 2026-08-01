---
paths:
  - "plugins/*/README.md"
---

# Rule: Install section in plugin READMEs

Every `plugins/*/README.md` must have `## Install` as its **first section** (immediately after the title), containing a fenced code block with the install command for that plugin.

**Required format** (replace `<plugin-name>` with the plugin's directory name):

````markdown
## Install

```

/plugin install <plugin-name>@kwitsch-plugins

```
````

**Model:** root `README.md` `## Install` section.

**After any Write or Edit to `plugins/*/README.md`:**

1. Check that `## Install` is the first `##`-level heading after the title line
2. Check that the section contains a fenced code block with `/plugin install <plugin-name>@kwitsch-plugins`
3. If missing or wrong → add or fix before finishing the edit
