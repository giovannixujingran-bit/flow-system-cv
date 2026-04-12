# Validation

Run these checks before closing work done with this skill.

## Skill validation

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
python (Join-Path $codexHome 'skills\.system\skill-creator\scripts\quick_validate.py') (Join-Path $codexHome 'skills\openclaw-external-task-pipeline')
```

If the validator fails with `ModuleNotFoundError: No module named 'yaml'`, run it from a Python environment that has `PyYAML` available or do a manual frontmatter/structure check before closing.

## Workspace validation

Preferred commands when `npm` is already on `PATH`:

```powershell
cd <flow-system-root>
npm run build --workspace @flow-system/flow-protocol
npm run build --workspace @flow-system/platform-api
npm run build --workspace @flow-system/platform-web
npm run typecheck --workspace @flow-system/platform-api
npm run typecheck --workspace @flow-system/platform-web
```

If `npm` is not on `PATH`, use the bundled runtime:

```powershell
$nodeDir = Join-Path (Get-Location) 'runtime\windows-tools\node-v22.22.0-win-x64'
$env:Path = "$nodeDir;$env:Path"
& "$nodeDir\npm.cmd" run build --workspace @flow-system/flow-protocol
& "$nodeDir\npm.cmd" run build --workspace @flow-system/platform-api
& "$nodeDir\npm.cmd" run build --workspace @flow-system/platform-web
& "$nodeDir\npm.cmd" run typecheck --workspace @flow-system/platform-api
& "$nodeDir\npm.cmd" run typecheck --workspace @flow-system/platform-web
```

## Acceptance checklist

- Intake accepts partially incomplete external payloads and still produces a validated canonical task or a clear validation failure.
- AI understanding output is re-validated before state write.
- `ExternalTaskRecord` persists `incoming`, `normalized`, `progress_items`, `latest_reply`, `reply_history`, `record_version`, and `updated_at`.
- A progress update advances the active stage and appends a new reply snapshot.
- `openclaw_reply` is appended only when conversation linkage exists.
- Serialized tasks expose optional `external_task` projection without breaking ordinary tasks.
- Task card UI consumes external projection when present and keeps the old fallback when absent.
- Progress and reply wording remain semantically aligned after an update.

## Regression focus

- Existing task delivery, checklist, and task detail flows still build cleanly.
- Existing conversations continue to work with current message types.
- Ordinary tasks still render on `/tasks` and `/tasks/[taskId]` without requiring external-task data.
