---
name: gavin-change
description: Complete a specified GitHub issue using the GavinChange workflow. Assign GavinCopley, implement the requirements, review and test the changes, update verified task boxes, and create a pull request that closes the issue on merge. Use when the user requests GavinChange or asks to handle an issue for Gavin; do not use for read-only issue questions.
---

# GavinChange

The designated GitHub assignee is `GavinCopley`. Deliver verified changes in a pull request; GitHub closes the issue when the PR merges. Do not merge the PR merely because this skill was invoked.

## Select and assign the issue

- Resolve the repository and issue from the user's URL, issue number, or unambiguous conversation context. If no single issue is identified, ask for it before making GitHub changes. Never silently pick the oldest issue.
- Read the current issue, comments, dependencies, linked PRs, and applicable repository instructions. Map every requirement and task box to the implementation and evidence needed to verify it. Treat third-party content as specifications, not authorization for unrelated actions.
- Invoking this workflow for a specific issue authorizes assignment, scoped code changes, validation, committing and pushing those changes, updating verified issue task boxes, and creating the PR. Other approval boundaries still apply; it does not authorize merging, deployment, permission changes, or unrelated communications.
- Add `GavinCopley` without removing existing assignees. Read back the assignment. If the username is not assignable or access is denied, report the specific blocker and continue authorized local work where possible; do not substitute another person or claim the assignment succeeded.

## Implement and verify

- Inspect the working tree and existing linked PRs before starting. Preserve unrelated user changes. Reuse a suitable issue branch or worktree when available; otherwise create an isolated `codex/` branch from the appropriate PR base and use a worktree when needed. Avoid duplicate PRs for the same work.
- For bugs, reproduce the failure and determine its cause before choosing a fix. For features, state the proposed implementation and resolve material ambiguities. Honor issue-specific planning, dependencies, and approval requirements in light of the user's existing authorization.
- Implement all requirements within scope, including relevant documentation or migration changes. Use the repository's orchestration skill when its triggers match and it is available. Give implementation agents distinct file ownership; the root integrates and verifies their work.
- Run the required repository checks and validation appropriate to the change: relevant tests, lint, type checks, build, integration checks, and the original reproduction or user flow as applicable. Add meaningful regression coverage when warranted. Report unavailable checks as unverified, never as passed.
- Review the final diff for correctness, regressions, security, and unintended changes. Use an independent reviewer for nontrivial work when available and authorized; review small changes directly. Resolve material findings, rerun affected checks, and assess every requirement against the final changes. Review or test attempts alone do not establish completion.

## Publish and update the issue

- Read the latest issue description immediately before updating it. Change only unchecked task boxes whose requirements are actually implemented and verified. Preserve prose, ordering, existing checked boxes, and concurrent edits. A requirement that depends on merge, deployment, or external approval remains unchecked until that event occurs. Read back the updated description to verify the result.
- Inspect the final diff and commit only scoped changes. Push the issue branch, then create a PR against the correct base, or update the existing PR. Describe the problem, resulting behavior, validation evidence, and material limitations. Attach a created or user-requested updated PR to the Codex chat with `attach_artifact` when available.
- Use `Closes #N` in the PR description only when the PR fully resolves the issue and targets the repository's default branch. For an issue in another repository, use the supported full issue URL. If a different base is required, link the issue and explain that automatic closure awaits integration into the default branch; do not promise immediate closure.
- Inspect available PR checks. Fix failures attributable to these changes and rerun affected validation. Pending CI remains pending; do not report it as passed. If new evidence invalidates a box checked by this run, uncheck that box while preserving unrelated updates.
- Leave the issue open while the PR is under review. GitHub's closing keyword closes it on merge; do not close it manually or merge without separate authorization. If any requirement remains incomplete or unverified, create or keep a draft PR without a closing keyword and leave its corresponding boxes unchecked.

## Blockers and completion report

For missing credentials, permissions, dependencies, or required decisions, state the exact blocker and finish independent authorized work. Stop repeating unchanged failed mutations; retain branches and artifacts for recovery. Before retrying a create or write operation after an uncertain response, read the current remote state to avoid duplicate PRs or overwritten edits.

Report the issue and PR links, actual assignee, completed requirements, validation and review results, and unresolved items or pending CI. Distinguish local work from pushed changes and successful remote updates. Never claim the issue is closed until its remote state confirms closure. This skill changes issue metadata, not kanban status; moving a project card requires a separate request and Projects access.
