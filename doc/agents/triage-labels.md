# Triage Labels

The skills speak in terms of five canonical triage roles plus two category roles. In this repo an issue's state lives in its frontmatter properties, not in label strings. This file maps each role to the property that carries it.

New issues start from `templates/doc-types/issue.md`. See `issue-tracker.md` for the file format.

| Label in mattpocock/skills | Label in our tracker                 | Meaning                                  |
| -------------------------- | ------------------------------------ | ---------------------------------------- |
| `needs-triage`             | `status: triage`                     | Maintainer needs to evaluate this issue  |
| `needs-info`               | `status: needs-info`                 | Waiting on reporter for more information |
| `ready-for-agent`          | `status: todo` + `assignee: agent`   | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `status: todo` + `assignee: human`   | Requires human implementation            |
| `wontfix`                  | `status: canceled`                   | Will not be actioned                     |
| `bug`                      | `tags: [bug]`                        | Something is broken                      |
| `enhancement`              | `tags: [enhancement]`                | New feature or improvement               |

Wayfinder states:

| Wayfinder state | Property in our tracker                    | Meaning                                         |
| --------------- | ------------------------------------------ | ----------------------------------------------- |
| claimed         | `status: in-progress`                      | An agent or human is working on it              |
| resolved        | `status: done`                             | Work finished                                   |
| ticket type     | `tags: [research]`, `[prototype]`, `[grilling]`, `[task]` | Kind of ticket (one type tag)    |
| blocked-by      | `blocked_by: ["[[NN-slug]]"]`              | Wikilinks to issues that must finish first      |
| parent          | `parent: "[[slug]]"`                       | Wikilink to the parent motive or issue          |

`status` takes only: `triage`, `needs-info`, `todo`, `in-progress`, `done`, `canceled`. `assignee` takes only: `agent`, `human`. `tags` also holds area tags alongside the category or type tag.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), set the corresponding property in the issue frontmatter from these tables.
