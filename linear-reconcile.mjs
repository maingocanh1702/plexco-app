#!/usr/bin/env node
/**
 * Reconcile the structure owned by progress.json into Linear.
 *
 * This is intentionally separate from linear-sync.mjs:
 *   - linear-reconcile pushes canonical titles/subtasks/parent links to Linear.
 *   - linear-sync pulls Linear-owned statuses back into progress.json.
 *
 * Default mode is read-only. Use --apply explicitly to mutate Linear.
 * The operation is idempotent and can resume after a partial API failure.
 *
 *   LINEAR_API_KEY=lin_api_xxx node linear-reconcile.mjs --check
 *   LINEAR_API_KEY=lin_api_xxx node linear-reconcile.mjs --apply
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedLinearModuleTitle, validateProgressLinearContract } from "./linear-contract.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const API = "https://api.linear.app/graphql";
const APPLY = process.argv.includes("--apply");
const EXPLICIT_CHECK = process.argv.includes("--check");
const KEY = process.env.LINEAR_API_KEY;

if (APPLY && EXPLICIT_CHECK) {
  console.error("✗ Chỉ dùng một trong --check hoặc --apply.");
  process.exit(1);
}
if (!KEY) {
  console.error("✗ Thiếu LINEAR_API_KEY.");
  process.exit(1);
}

async function gql(query, variables = {}) {
  const response = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: KEY },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors) {
    throw new Error(
      `Linear ${response.status}: ${JSON.stringify(body?.errors || body || "invalid response")}`,
    );
  }
  return body.data;
}

const ISSUE_FIELDS = `
  id identifier title description archivedAt
  team { id key }
  project { id name }
  state { id name type }
  parent { id identifier }
  labels { nodes { id name } }
`;

async function fetchAllIssues() {
  const issues = [];
  let after = null;
  do {
    const data = await gql(
      `query AllIssues($after: String) {
        issues(first: 100, after: $after, includeArchived: true) {
          pageInfo { hasNextPage endCursor }
          nodes { ${ISSUE_FIELDS} }
        }
      }`,
      { after },
    );
    issues.push(...data.issues.nodes);
    after = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
  } while (after);
  return issues;
}

async function updateIssue(id, input) {
  const data = await gql(
    `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { ${ISSUE_FIELDS} }
      }
    }`,
    { id, input },
  );
  if (!data.issueUpdate.success || !data.issueUpdate.issue) {
    throw new Error(`Linear issueUpdate không thành công cho ${id}`);
  }
  return data.issueUpdate.issue;
}

async function createIssue(input) {
  const data = await gql(
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { ${ISSUE_FIELDS} }
      }
    }`,
    { input },
  );
  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error(`Linear issueCreate không thành công cho ${input.title}`);
  }
  return data.issueCreate.issue;
}

function sameIds(left, right) {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
}

function canonicalSubtasks(progress) {
  return progress.modules.flatMap((module) =>
    (module.subtasks || []).map((subtask) => ({ module, subtask })),
  );
}

function findReusableSubtask(issues, module, subtask, parent) {
  const byIdentifier = issues.find((issue) => issue.identifier === subtask.identifier);
  if (byIdentifier) {
    if (byIdentifier.team.id !== parent.team.id) {
      throw new Error(
        `${subtask.identifier} thuộc team ${byIdentifier.team.key}, không phải team của ${module.id}`,
      );
    }
    return byIdentifier;
  }

  const exact = issues.filter(
    (issue) =>
      !issue.archivedAt &&
      issue.team.id === parent.team.id &&
      issue.parent?.id === parent.id &&
      issue.title === subtask.title,
  );
  if (exact.length > 1) {
    throw new Error(
      `${module.id}: có nhiều subtask Linear trùng title ${JSON.stringify(subtask.title)}`,
    );
  }
  return exact[0] || null;
}

function subtaskPatch(issue, subtask, parent, labelId, projectId) {
  const currentLabelIds = issue.labels.nodes.map((label) => label.id);
  const wantedLabelIds = [...new Set([...currentLabelIds, labelId])];
  const input = {};
  if (issue.title !== subtask.title) input.title = subtask.title;
  if (issue.parent?.id !== parent.id) input.parentId = parent.id;
  if (issue.project?.id !== projectId) input.projectId = projectId;
  if (!sameIds(currentLabelIds, wantedLabelIds)) input.labelIds = wantedLabelIds;
  return input;
}

function validateRemote(progress, issues, labelName, projectId) {
  const errors = [];
  const byIdentifier = new Map(issues.map((issue) => [issue.identifier, issue]));
  for (const module of progress.modules) {
    const parent = byIdentifier.get(module.linearId);
    if (!parent) {
      errors.push(`${module.id}: thiếu parent ${module.linearId}`);
      continue;
    }
    const expectedParentTitle = expectedLinearModuleTitle(module);
    if (parent.title !== expectedParentTitle) {
      errors.push(`${module.linearId}: title chưa canonical`);
    }
    for (const subtask of module.subtasks || []) {
      const issue = byIdentifier.get(subtask.identifier);
      if (!issue) {
        errors.push(`${module.id}: thiếu ${subtask.identifier}`);
        continue;
      }
      if (issue.archivedAt) errors.push(`${subtask.identifier}: đang archived`);
      if (issue.title !== subtask.title) errors.push(`${subtask.identifier}: title chưa canonical`);
      if (issue.parent?.id !== parent.id) errors.push(`${subtask.identifier}: sai parent`);
      if (issue.project?.id !== projectId) errors.push(`${subtask.identifier}: sai project`);
      if (!issue.labels.nodes.some((label) => label.name === labelName)) {
        errors.push(`${subtask.identifier}: thiếu label ${labelName}`);
      }
    }
  }
  return errors;
}

async function main() {
  const progressPath = join(__dir, "progress.json");
  const progress = JSON.parse(readFileSync(progressPath, "utf8"));
  const contractErrors = validateProgressLinearContract(progress);
  if (contractErrors.length) {
    throw new Error(`progress.json vi phạm contract:\n${contractErrors.join("\n")}`);
  }

  let issues = await fetchAllIssues();
  const byIdentifier = new Map(issues.map((issue) => [issue.identifier, issue]));
  const parents = new Map();
  for (const module of progress.modules) {
    const parent = byIdentifier.get(module.linearId);
    if (!parent || parent.archivedAt) {
      throw new Error(
        `${module.id}: parent ${module.linearId} thiếu hoặc archived; không tự tạo parent`,
      );
    }
    parents.set(module.id, parent);
  }

  const teamIds = new Set([...parents.values()].map((issue) => issue.team.id));
  if (teamIds.size !== 1) throw new Error("Các parent module không cùng một Linear team");

  const labelName = progress.linear.label;
  const label = [...parents.values()]
    .flatMap((issue) => issue.labels.nodes)
    .find((candidate) => candidate.name === labelName);
  if (!label) throw new Error(`Không tìm thấy label ${labelName} trên các parent module`);

  const projectName = progress.linear.project;
  const project = [...parents.values()]
    .map((issue) => issue.project)
    .find((candidate) => candidate?.name === projectName);
  if (!project) throw new Error(`Không tìm thấy project ${projectName} trên các parent module`);

  const parentTitleChanges = progress.modules.filter(
    (module) => parents.get(module.id).title !== expectedLinearModuleTitle(module),
  );
  const createPlans = [];
  const repairPlans = [];
  for (const { module, subtask } of canonicalSubtasks(progress)) {
    const parent = parents.get(module.id);
    const existing = findReusableSubtask(issues, module, subtask, parent);
    if (!existing) {
      createPlans.push({ module, subtask, parent });
      continue;
    }
    if (existing.archivedAt) {
      throw new Error(
        `${existing.identifier}: subtask canonical đang archived; cần owner xử lý thủ công`,
      );
    }
    const input = subtaskPatch(existing, subtask, parent, label.id, project.id);
    if (Object.keys(input).length || existing.identifier !== subtask.identifier) {
      repairPlans.push({ module, subtask, parent, existing, input });
    }
  }

  console.log(
    `Linear reconcile plan: ${parentTitleChanges.length} parent title · ${createPlans.length} create · ${repairPlans.length} repair/remap`,
  );
  for (const module of parentTitleChanges) {
    console.log(`  UPDATE ${module.linearId} title → ${expectedLinearModuleTitle(module)}`);
  }
  for (const { module, subtask } of createPlans) {
    console.log(`  CREATE ${module.id}/${subtask.identifier} ${subtask.title}`);
  }
  for (const { subtask, existing, input } of repairPlans) {
    const actions = [...Object.keys(input)];
    if (existing.identifier !== subtask.identifier) actions.push(`remap→${existing.identifier}`);
    console.log(`  REPAIR ${existing.identifier} (${actions.join(", ")})`);
  }

  const planned = parentTitleChanges.length + createPlans.length + repairPlans.length;
  if (!APPLY) {
    if (!planned) {
      console.log("✓ Linear structure đã khớp progress.json; không có mutation.");
      return;
    }
    console.error("✗ Dry-run phát hiện structural drift; chạy --apply để reconcile.");
    process.exitCode = 2;
    return;
  }

  for (const module of parentTitleChanges) {
    await updateIssue(module.linearId, { title: expectedLinearModuleTitle(module) });
  }

  let progressChanged = false;
  for (const plan of repairPlans) {
    let issue = plan.existing;
    if (Object.keys(plan.input).length) issue = await updateIssue(issue.id, plan.input);
    if (plan.subtask.identifier !== issue.identifier) {
      console.log(`  REMAP ${plan.subtask.identifier} → ${issue.identifier}`);
      plan.subtask.identifier = issue.identifier;
      progressChanged = true;
    }
  }

  for (const { module, subtask, parent } of createPlans) {
    const issue = await createIssue({
      teamId: parent.team.id,
      projectId: project.id,
      parentId: parent.id,
      labelIds: [label.id],
      title: subtask.title,
      description: `Canonical DoD subtask for ${module.id}. Source: progress.json.`,
    });
    console.log(`  CREATED ${issue.identifier} (${module.id}; expected ${subtask.identifier})`);
    if (subtask.identifier !== issue.identifier) {
      subtask.identifier = issue.identifier;
      progressChanged = true;
    }
  }

  if (progressChanged) {
    progress.updatedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
    execFileSync(process.execPath, [join(__dir, "sync-embedded.mjs")], { stdio: "inherit" });
  }

  issues = await fetchAllIssues();
  const remoteErrors = validateRemote(progress, issues, labelName, project.id);
  if (remoteErrors.length) {
    throw new Error(`Post-apply verification failed:\n${remoteErrors.join("\n")}`);
  }
  console.log("✓ Linear structure đã reconcile và post-verify khớp progress.json.");
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
