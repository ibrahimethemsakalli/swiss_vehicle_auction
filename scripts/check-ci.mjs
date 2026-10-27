import { loadYaml, validateWorkflow } from './ci-workflow-policy.mjs';
validateWorkflow(loadYaml('.github/workflows/ci.yml'));
const dependabot = loadYaml('.github/dependabot.yml');
if (
  dependabot.version !== 2 ||
  !['npm', 'github-actions'].every((name) =>
    dependabot.updates.some((item) => item['package-ecosystem'] === name),
  )
)
  throw new Error('DEPENDABOT_CONFIG_INVALID');
console.log(
  'PASS: CI YAML, least privilege, pinned actions, non-bypassed audit and Dependabot configuration.',
);
