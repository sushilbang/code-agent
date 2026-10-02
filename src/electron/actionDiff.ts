import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff';
import type { AgentFileChange, AgentPathChange } from './workspace';

const maxDisplayLength = 80_000;

export function buildActionDiff(change: AgentFileChange | AgentPathChange): string | undefined {
  if ('operation' in change && (change.operation === 'create_directory' || change.operation === 'delete_directory')) return undefined;
  if ('operation' in change && change.operation === 'delete_file' && change.before?.startsWith('(binary or large file,')) return undefined;

  const before = change.before ?? '';
  const after = change.after;
  if (before === after) return undefined;
  const oldName = change.before === null ? '/dev/null' : `a/${change.path}`;
  const newName = 'operation' in change && change.operation === 'delete_file' ? '/dev/null' : `b/${change.path}`;
  const patch = createTwoFilesPatch(oldName, newName, before, after, undefined, undefined, {
    context: 3,
    maxEditLength: 10_000,
    headerOptions: FILE_HEADERS_ONLY
  });
  if (!patch || patch.length > maxDisplayLength) return 'Diff is too large to display. Open the file to review its contents.';
  return patch.trimEnd();
}
