// What the coding agent is told. Three situations, three prompts: a fresh build,
// a continuation of work that already exists, and a short fix round for failing tests.

const RULES = [
  'ENVIRONMENT RULES (not negotiable):',
  '- Work only inside this directory. Never read or write outside it.',
  '- Install dependencies only inside this project (uv, a venv, or node_modules here). Never run pip against the system Python, never use --break-system-packages, never use sudo.',
  '- Leave no scratch folders (.chroma, caches, notes) in the repository.',
  '- Do not run git commands; the agent commits for you.',
  '- Be economical: read only what you need, make the smallest change, and do not re-run the whole test suite over and over.',
].join('\n');

const criteriaOf = (spec) => spec.acceptance_criteria.map((c) => `- ${c}`).join('\n');
const contextOf = (spec) => spec.context.map((c) => `- [${c.kind}] ${c.title} (${c.author}): ${c.body}`).join('\n');
const header = (spec) => [
  `You are implementing one story in the ${spec.project_name} repository, in this directory.`,
  '',
  `STORY ${spec.task_key}: ${spec.task_title}`,
  spec.task_description ? `NOTES: ${spec.task_description}` : '',
  '',
  'ACCEPTANCE CRITERIA:',
  criteriaOf(spec),
  '',
];
/** What the developer added on top: a reviewer's requested changes, their instruction, where to start. */
const extras = (spec) => {
  const out = [];
  if (spec.rework) out.push(`CHANGES REQUESTED ON THE PREVIOUS PULL REQUEST (do these first):\n${spec.rework}\n`);
  const brief = spec.brief ?? {};
  if (brief.instruction?.trim()) out.push(`INSTRUCTION FROM THE DEVELOPER WHO OWNS THIS TASK (it wins over the notes above if they conflict):\n${brief.instruction.trim()}\n`);
  if (brief.focus?.length) out.push(`START FROM THESE FILES OR FOLDERS (read these first):\n${brief.focus.map((f) => `- ${f}`).join('\n')}\n`);
  return out;
};
const shared = (spec) => (spec.context.length ? [`SHARED PROJECT CONTEXT (approved design, decisions, handoffs and review feedback; follow them):\n${contextOf(spec)}\n`] : ['']);

/** A story that has not been started. */
export function buildPrompt(spec) {
  return [
    ...header(spec),
    ...shared(spec),
    ...extras(spec),
    'How to work:',
    '1. Read README, AGENTS.md if present, and the code you will change first. Follow the existing style.',
    '2. Make the smallest change that meets every criterion.',
    '3. Add or update tests that prove each criterion, then run the test suites and fix failures.',
    '4. Do not add dependencies the story does not need. Do not weaken or delete existing tests.',
    '',
    RULES,
    'When you are done, reply with a short summary of what you changed and how you tested it.',
  ].join('\n');
}

const tail = (s, n) => (s.length > n ? `…${s.slice(-n)}` : s);

function failuresText(failing) {
  return failing
    .slice(0, 2)
    .map((f) => {
      const counts = f.total != null ? ` (${f.failed ?? 0} failed of ${f.total})` : '';
      return `--- ${f.suite}${counts}: ${f.command ?? ''}\n${tail((f.output ?? '').trim(), 2500) || '(no output captured)'}`;
    })
    .join('\n\n');
}

/** Work that already exists in this directory: say what is there and what is wrong, so nothing is redone. */
export function continuePrompt(spec, state, failing) {
  const files = state.files.map((l) => `  ${l}`).join('\n') + (state.more ? `\n  … and ${state.more} more` : '');
  return [
    ...header(spec),
    ...shared(spec),
    ...extras(spec),
    'THIS IS A CONTINUATION. Earlier work on this story is already in this directory. Do NOT start over and do NOT redo anything that already works.',
    '',
    `WHAT EXISTS NOW (changed against the base branch${state.summary ? `: ${state.summary}` : ''}):`,
    files,
    '',
    failing.length ? `WHAT IS WRONG (latest test run):\n${failuresText(failing)}` : 'The tests pass. Check the acceptance criteria above against the existing change and finish only what is missing.',
    '',
    'How to work:',
    '1. Read only the changed files above and whatever the failures point to.',
    '2. Fix what is wrong or missing with the smallest change. Keep what already works.',
    '3. Re-run only the failing suite to confirm.',
    '',
    RULES,
    'When you are done, reply with a short summary of what you changed this time.',
  ].join('\n');
}

/** A short round after tests failed: only the failures, nothing else. */
export function fixPrompt(spec, failing) {
  return [
    `The change for story ${spec.task_key} (${spec.task_title}) in this directory is written, but its tests fail.`,
    'Fix the cause of these failures. Do not rewrite working code and do not weaken or delete tests to make them pass.',
    '',
    failuresText(failing),
    '',
    'Re-run only the failing suite to confirm.',
    '',
    RULES,
    'Reply with one or two sentences on the cause and the fix.',
  ].join('\n');
}

/** The developer read the work and wants one specific change. */
export function changePrompt(spec, note) {
  return [
    `The change for story ${spec.task_key} (${spec.task_title}) in this directory is written. The developer who owns it reviewed it and asks for this:`,
    '',
    note.trim(),
    '',
    'Make exactly this change and nothing else. Keep everything that already works and every existing test.',
    '',
    RULES,
    'Reply with one or two sentences on what you changed.',
  ].join('\n');
}

/** The fix round, with the developer's own words on how to fix it. */
export function fixPromptWithNote(spec, failing, note) {
  return `${fixPrompt(spec, failing)}\n\nTHE DEVELOPER SAYS HOW TO FIX IT:\n${note.trim()}\n`;
}
