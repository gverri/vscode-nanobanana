import * as vscode from 'vscode';

const API_KEY_SECRET = 'nanobanana.geminiApiKey';

export class StorageManager {
  constructor(private context: vscode.ExtensionContext) {}

  async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(API_KEY_SECRET);
  }

  async setApiKey(key: string): Promise<void> {
    await this.context.secrets.store(API_KEY_SECRET, key);
  }

  async deleteApiKey(): Promise<void> {
    await this.context.secrets.delete(API_KEY_SECRET);
  }

  async hasApiKey(): Promise<boolean> {
    const key = await this.getApiKey();
    return !!key && key.length > 0;
  }
}
