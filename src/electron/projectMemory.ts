import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectMemory, ProjectMemoryInput } from '../shared/types';
import { containsLikelySecret } from './agent/memorySafety';

function validate(input: ProjectMemoryInput): ProjectMemoryInput {
  if (!input || typeof input !== 'object' || (input.id !== undefined && (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.id))) ||
    typeof input.topic !== 'string' || !input.topic.trim() || input.topic.trim().length > 80 ||
    typeof input.value !== 'string' || !input.value.trim() || input.value.trim().length > 1000 ||
    typeof input.enabled !== 'boolean' || !input.source || !['user', 'file'].includes(input.source.kind) ||
    (input.source.reference !== undefined && (typeof input.source.reference !== 'string' || input.source.reference.length > 300)) ||
    (input.source.kind === 'file' && !input.source.reference?.trim())) throw new Error('Invalid project memory.');
  if (containsLikelySecret(`${input.topic}\n${input.value}\n${input.source.reference || ''}`)) {
    throw new Error('Project memory appears to contain a credential. Remove it before saving.');
  }
  return { id: input.id, topic: input.topic.trim(), value: input.value.trim(), enabled: input.enabled,
    source: { kind: input.source.kind, reference: input.source.reference?.trim() || undefined } };
}

export class ProjectMemoryStore {
  private queue = Promise.resolve();
  private file: string;

  constructor(directory: string) { this.file = path.join(directory, 'memories.json'); }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<ProjectMemory[]> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!Array.isArray(value)) throw new Error('Invalid project memory file.');
      return value as ProjectMemory[];
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  private async write(items: ProjectMemory[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(items), 'utf8');
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  list(root: string): Promise<ProjectMemory[]> {
    return this.serialized(async () => (await this.read()).filter(item => item.workspaceRoot === root)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  save(root: string, raw: ProjectMemoryInput): Promise<ProjectMemory[]> {
    const input = validate(raw);
    return this.serialized(async () => {
      const items = await this.read();
      const index = input.id ? items.findIndex(item => item.id === input.id && item.workspaceRoot === root) : -1;
      if (input.id && index < 0) throw new Error('Project memory not found in this workspace.');
      if (items.some((item, position) => position !== index && item.workspaceRoot === root && item.topic.toLocaleLowerCase() === input.topic.toLocaleLowerCase())) {
        throw new Error('A memory with this topic already exists. Edit it instead.');
      }
      if (index < 0 && items.filter(item => item.workspaceRoot === root).length >= 100) throw new Error('This workspace has reached its 100-memory limit.');
      const now = new Date().toISOString();
      const item: ProjectMemory = { id: input.id || randomUUID(), workspaceRoot: root, topic: input.topic, value: input.value,
        source: input.source, enabled: input.enabled, createdAt: index < 0 ? now : items[index].createdAt, updatedAt: now };
      if (index < 0) items.push(item); else items[index] = item;
      await this.write(items);
      return items.filter(entry => entry.workspaceRoot === root).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  delete(root: string, id: string): Promise<ProjectMemory[]> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid project memory id.');
    return this.serialized(async () => {
      const items = await this.read();
      if (!items.some(item => item.id === id && item.workspaceRoot === root)) throw new Error('Project memory not found in this workspace.');
      const remaining = items.filter(item => !(item.id === id && item.workspaceRoot === root));
      await this.write(remaining);
      return remaining.filter(item => item.workspaceRoot === root).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }
}
