import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChatRecord, ChatSummary, ContextSettings } from '../shared/types';
import { DEFAULT_CONTEXT_SETTINGS, isContextSettings } from '../shared/context';

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class LocalStore {
  private queue = Promise.resolve();
  constructor(private directory: string) {}

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async listChats(): Promise<ChatSummary[]> {
    return this.serialized(async () => (await readJson<ChatRecord[]>(path.join(this.directory, 'chats.json'), []))
      .map(({ id, title, workspaceRoot, updatedAt }) => ({ id, title, workspaceRoot, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  async getChat(id: string): Promise<ChatRecord | null> {
    return this.serialized(async () => (await readJson<ChatRecord[]>(path.join(this.directory, 'chats.json'), []))
      .find(chat => chat.id === id) || null);
  }

  async saveChat(chat: ChatRecord): Promise<void> {
    const serialized = JSON.stringify(chat);
    if (!chat || typeof chat.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(chat.id) ||
      typeof chat.title !== 'string' || typeof chat.workspaceRoot !== 'string' ||
      typeof chat.updatedAt !== 'string' || !Array.isArray(chat.messages) || serialized.length > 5_000_000 ||
      chat.messages.some(message => !message || typeof message.id !== 'string' ||
        !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string') ||
      (chat.contextUsage !== undefined && (!chat.contextUsage || !Number.isSafeInteger(chat.contextUsage.inputTokens) ||
        chat.contextUsage.inputTokens < 0 || !['estimate', 'api'].includes(chat.contextUsage.source) ||
        (chat.contextUsage.outputTokens !== undefined && (!Number.isSafeInteger(chat.contextUsage.outputTokens) || chat.contextUsage.outputTokens < 0)))) ||
      (chat.contextCheckpoints !== undefined && (!Array.isArray(chat.contextCheckpoints) || chat.contextCheckpoints.length > 10 ||
        chat.contextCheckpoints.some(checkpoint => !checkpoint || typeof checkpoint.at !== 'string' ||
          !Array.isArray(checkpoint.recentRequests) || checkpoint.recentRequests.length > 3 ||
          checkpoint.recentRequests.some(text => typeof text !== 'string' || text.length > 500) ||
          (checkpoint.selectedFile !== undefined && (typeof checkpoint.selectedFile !== 'string' || checkpoint.selectedFile.length > 1000)) ||
          !Array.isArray(checkpoint.toolPaths) || checkpoint.toolPaths.length > 8 ||
          checkpoint.toolPaths.some(item => typeof item !== 'string' || item.length > 1000))))) {
      throw new Error('Invalid chat record.');
    }
    await this.serialized(async () => {
      const file = path.join(this.directory, 'chats.json');
      const chats = await readJson<ChatRecord[]>(file, []);
      const index = chats.findIndex(item => item.id === chat.id);
      if (index >= 0) chats[index] = chat;
      else chats.push(chat);
      chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await writeJson(file, chats.slice(0, 100));
    });
  }

  async deleteChat(id: string): Promise<void> {
    await this.serialized(async () => {
      const file = path.join(this.directory, 'chats.json');
      const chats = await readJson<ChatRecord[]>(file, []);
      await writeJson(file, chats.filter(chat => chat.id !== id));
    });
  }

  async allowedActions(root: string): Promise<string[]> {
    return this.serialized(async () => (await readJson<Record<string, string[]>>(path.join(this.directory, 'permissions.json'), {}))[root] || []);
  }

  async allowAction(root: string, tool: string): Promise<void> {
    await this.serialized(async () => {
      const file = path.join(this.directory, 'permissions.json');
      const permissions = await readJson<Record<string, string[]>>(file, {});
      permissions[root] = [...new Set([...(permissions[root] || []), tool])];
      await writeJson(file, permissions);
    });
  }

  async revokeAction(root: string, tool: string): Promise<string[]> {
    return this.serialized(async () => {
      const file = path.join(this.directory, 'permissions.json');
      const permissions = await readJson<Record<string, string[]>>(file, {});
      permissions[root] = (permissions[root] || []).filter(item => item !== tool);
      await writeJson(file, permissions);
      return permissions[root];
    });
  }

  async getEncryptedOpenAIKey(): Promise<string | null> {
    return this.serialized(async () => {
      const settings = await readJson<{ openAIKey?: unknown }>(path.join(this.directory, 'settings.json'), {});
      return typeof settings.openAIKey === 'string' && settings.openAIKey ? settings.openAIKey : null;
    });
  }

  async setEncryptedOpenAIKey(value: string | null): Promise<void> {
    await this.serialized(async () => {
      const file = path.join(this.directory, 'settings.json');
      const settings = await readJson<Record<string, unknown>>(file, {});
      if (value) settings.openAIKey = value;
      else delete settings.openAIKey;
      await writeJson(file, settings);
    });
  }

  async getContextSettings(): Promise<ContextSettings> {
    return this.serialized(async () => {
      const settings = await readJson<{ contextSettings?: unknown }>(path.join(this.directory, 'settings.json'), {});
      return isContextSettings(settings.contextSettings) ? settings.contextSettings : { ...DEFAULT_CONTEXT_SETTINGS };
    });
  }

  async setContextSettings(value: ContextSettings): Promise<ContextSettings> {
    if (!isContextSettings(value)) throw new Error('Invalid context settings.');
    return this.serialized(async () => {
      const file = path.join(this.directory, 'settings.json');
      const settings = await readJson<Record<string, unknown>>(file, {});
      settings.contextSettings = value;
      await writeJson(file, settings);
      return value;
    });
  }
}
