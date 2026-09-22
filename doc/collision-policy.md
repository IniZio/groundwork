# Skill-name Collision Policy

Skills load with namespace prefixes: groundwork's skills load as `groundwork:<name>`, mattpocock-skills loads as `mattpocock-skills:<name>`. The two `implement` skills coexist without conflict. groundwork's instruction layer references `groundwork:implement` explicitly.

OQ-2 resolved: namespacing is enforced by the plugin harness; no install-order dependency is required. See https://code.claude.com/docs/en/plugin-dependencies.md.

The `prototype` skill is deleted from groundwork (D-14); mattpocock-skills provides it directly.
