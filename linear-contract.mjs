const STATUS_VALUES = new Set(["not_started", "in_progress", "in_review", "done", "blocked"]);

export function expectedLinearModuleTitle(module) {
  return `[${module.id}] ${module.name}`;
}

export function validateProgressLinearContract(progress) {
  const errors = [];
  if (!Array.isArray(progress?.modules)) return ["progress.json: modules phải là array"];

  const moduleIds = new Set();
  const issueIds = new Set();
  for (const module of progress.modules) {
    if (!module.id || !/^M\d+$/.test(module.id))
      errors.push(`module id không hợp lệ: ${JSON.stringify(module.id)}`);
    else if (moduleIds.has(module.id)) errors.push(`module id trùng: ${module.id}`);
    else moduleIds.add(module.id);

    if (!module.name?.trim()) errors.push(`${module.id || "module"}: thiếu name`);
    if (!STATUS_VALUES.has(module.status))
      errors.push(`${module.id || "module"}: status không hợp lệ ${JSON.stringify(module.status)}`);

    if (!module.linearId) errors.push(`${module.id || "module"}: thiếu linearId`);
    else if (issueIds.has(module.linearId))
      errors.push(`${module.id || "module"}: Linear identifier trùng ${module.linearId}`);
    else issueIds.add(module.linearId);

    for (const subtask of module.subtasks || []) {
      if (!subtask.title?.trim()) errors.push(`${module.id || "module"}: subtask thiếu title`);
      if (!subtask.identifier)
        errors.push(
          `${module.id || "module"}: subtask ${JSON.stringify(subtask.title)} thiếu identifier`,
        );
      else if (issueIds.has(subtask.identifier))
        errors.push(`${module.id || "module"}: Linear identifier trùng ${subtask.identifier}`);
      else issueIds.add(subtask.identifier);
      if (!STATUS_VALUES.has(subtask.status)) {
        errors.push(
          `${module.id || "module"}/${subtask.identifier || "subtask"}: status không hợp lệ ${JSON.stringify(subtask.status)}`,
        );
      }
    }
  }

  return errors;
}
