// Fuzzy file-path matching for Quick Open: query characters must appear in order, with bonuses for
// word starts, camelCase humps, consecutive runs, and matches that stay inside the file name.
export interface FuzzyMatch { score: number; indexes: number[] }

const separators = new Set(['/', '\\', '.', '-', '_', ' ']);

function characterScore(target: string, position: number, consecutive: boolean, exactCase: boolean): number {
  let score = 1;
  if (consecutive) score += 5;
  const previous = position > 0 ? target[position - 1] : '/';
  const current = target[position];
  if (separators.has(previous)) score += 8;
  else if (previous === previous.toLowerCase() && previous !== previous.toUpperCase() && current !== current.toLowerCase()) score += 6;
  if (exactCase) score += 1;
  return score;
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const needle = query.replace(/\s+/g, '').toLowerCase();
  if (!needle) return { score: 0, indexes: [] };
  if (needle.length > target.length) return null;
  const haystack = target.toLowerCase();
  // Cheap rejection: the query must be a subsequence of the target.
  let cursor = 0;
  for (const character of needle) { cursor = haystack.indexOf(character, cursor); if (cursor < 0) return null; cursor++; }

  const rows = needle.length, columns = target.length;
  const compact = query.replace(/\s+/g, '');
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(-Infinity));
  const parent: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(-1));
  for (let row = 0; row < rows; row++) {
    // Best score of the previous row at any column before j - 1 (a gap), tracked as a running prefix maximum.
    let gapBest = -Infinity, gapAt = -1;
    for (let column = row; column < columns; column++) {
      if (column - 2 >= 0 && row > 0 && dp[row - 1][column - 2] > gapBest) { gapBest = dp[row - 1][column - 2]; gapAt = column - 2; }
      if (haystack[column] !== needle[row]) continue;
      const exactCase = target[column] === compact[row];
      if (row === 0) { dp[0][column] = characterScore(target, column, false, exactCase); continue; }
      let best = -Infinity, from = -1;
      if (column >= 1 && dp[row - 1][column - 1] > -Infinity) { best = dp[row - 1][column - 1] + characterScore(target, column, true, exactCase); from = column - 1; }
      if (gapBest > -Infinity) {
        const viaGap = gapBest + characterScore(target, column, false, exactCase) - 1; // small penalty for skipping characters
        if (viaGap > best) { best = viaGap; from = gapAt; }
      }
      dp[row][column] = best; parent[row][column] = from;
    }
  }
  let end = -1, top = -Infinity;
  for (let column = 0; column < columns; column++) if (dp[rows - 1][column] > top) { top = dp[rows - 1][column]; end = column; }
  if (end < 0 || top === -Infinity) return null;
  const indexes = new Array<number>(rows);
  for (let row = rows - 1, column = end; row >= 0; row--) { indexes[row] = column; column = parent[row][column]; }
  const nameStart = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')) + 1;
  let score = top;
  if (indexes[0] >= nameStart) score += 30;               // every character is inside the file name
  if (indexes[0] === nameStart) score += 20;              // and it starts the file name
  score -= target.length * 0.05;                          // prefer shorter paths
  return { score, indexes };
}

export interface RankedPath { path: string; score: number; indexes: number[] }

export function rankPaths(query: string, paths: readonly string[], limit = 50): RankedPath[] {
  if (!query.trim()) return paths.slice(0, limit).map(path => ({ path, score: 0, indexes: [] }));
  const ranked: RankedPath[] = [];
  for (const path of paths) {
    const match = fuzzyMatch(query, path);
    if (match) ranked.push({ path, ...match });
  }
  return ranked.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path)).slice(0, limit);
}
