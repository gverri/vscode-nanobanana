export interface PrePrompt {
  id: string;
  name: string;
  prompt: string;
  isDefault: boolean;
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

export interface ImageConfig {
  model?: string;
  aspectRatio?: string;
  numberOfImages?: number;
}

export interface SelectionInfo {
  text: string;
  lineCount: number;
}

// Messages from Webview to Extension
export type WebviewMessage =
  | { command: 'ready' }
  | { command: 'generate'; prompt: string; prePromptId: string; useSelection: boolean }
  | { command: 'saveApiKey'; apiKey: string }
  | { command: 'deleteApiKey' }
  | { command: 'downloadImage'; base64: string; filename: string }
  | { command: 'openInOS'; base64: string }
  | { command: 'addPrePrompt'; name: string; prompt: string }
  | { command: 'updatePrePrompt'; id: string; name: string; prompt: string }
  | { command: 'deletePrePrompt'; id: string }
  | { command: 'confirmDeletePrePrompt'; id: string }
  | { command: 'getSelection' };

// Messages from Extension to Webview
export type ExtensionMessage =
  | { command: 'init'; hasApiKey: boolean; prePrompts: PrePrompt[]; selection: SelectionInfo | null; config: { aspectRatio: string; model: string } }
  | { command: 'generating' }
  | { command: 'generated'; image: GeneratedImage }
  | { command: 'error'; message: string }
  | { command: 'prePromptsUpdated'; prePrompts: PrePrompt[] }
  | { command: 'selectionChanged'; selection: SelectionInfo | null }
  | { command: 'apiKeyUpdated'; hasApiKey: boolean }
  | { command: 'confirmDelete'; id: string };
