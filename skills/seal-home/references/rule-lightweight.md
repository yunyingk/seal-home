# Rule Lightweight Queries

Use this reference when the user wants rule counts, compact rule lists, one rule from a historical version, or approval knowledge search without dumping hundreds of rule descriptions.

## Count Rules

Use count when only scale or existence matters.

```bash
seal-home rules count --corp <corpId>
```

Expected shape:

```json
{ "count": 191 }
```

Tool-layer equivalent:

```bash
seal-home tool seal_approval_rules_list --json '{"countOnly":true}'
seal-home tool seal_approval_rules_list --json '{"fields":["id"],"limit":0}'
```

## List Rule Summaries

Use summaries for navigation and selection.

```bash
seal-home rules list --corp <corpId> --summary
```

Default summary should include only fields such as `id`, `scope`, `strictness`, `status`, and `updatedAt`. Do not pull `description` unless the user needs rule text.

Tool-layer equivalent:

```bash
seal-home tool seal_approval_rules_list --json '{"fields":["id","scope","strictness","status","updatedAt"]}'
```

## Get One Historical Rule

Use this when a run used a historical rule version and current rules may differ.

```bash
seal-home rules get --version 16 --code '#0038'
seal-home rules get --version latest --code '#0038'
```

If the user starts from a run and a runtime ID such as `rule-205`, resolve against that run:

```bash
seal-home rules get --record-id <recordId> --runtime-id rule-205
```

Return the single rule text plus `scope`, `strictness`, `status`, `versionNumber`, and version metadata. Avoid commands that dump a whole rule version unless the user asks for the full version.

## Search Approval Knowledge Compactly

Prefer scoped and trimmed search:

```bash
seal-home tool seal_approval_search --json '{"keywords":["关键词"],"areas":["rules"],"matchMode":"any","maxResults":20,"snippetOnly":true,"maxChars":500,"fields":["id","title","snippet"]}'
```

When investigating historical behavior, search the matching rule version if the API supports it:

```bash
seal-home tool seal_approval_search --json '{"keywords":["关键词"],"areas":["rules"],"ruleVersionScope":"version","versionNumber":16,"snippetOnly":true,"maxChars":500}'
```

Use current search only when the question is about current draft/current knowledge, not why a historical run behaved a certain way.

## Output Discipline

If a rule command would return many descriptions or more than about 20 rules, use `rules count`, `rules list --summary`, `fields`, `snippetOnly`, or `--output-file`. Use `--full` only for deliberate exports.
