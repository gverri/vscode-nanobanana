import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { StorageManager } from '../storage/storageManager';
import { GeminiService } from '../services/geminiService';
import { PrePromptService } from '../services/prePromptService';
import type { WebviewMessage, ExtensionMessage, SelectionInfo } from '../types';

export class NanoBananaPanel {
  public static currentPanel: NanoBananaPanel | undefined;
  private static readonly viewType = 'nanoBanana';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly storageManager: StorageManager;
  private readonly geminiService: GeminiService;
  private readonly prePromptService: PrePromptService;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext): NanoBananaPanel {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (NanoBananaPanel.currentPanel) {
      NanoBananaPanel.currentPanel.panel.reveal(column);
      return NanoBananaPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      NanoBananaPanel.viewType,
      'Nano Banana',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );

    NanoBananaPanel.currentPanel = new NanoBananaPanel(panel, context);
    return NanoBananaPanel.currentPanel;
  }

  public static async createWithSelection(context: vscode.ExtensionContext): Promise<NanoBananaPanel> {
    const panel = NanoBananaPanel.createOrShow(context);
    const selection = NanoBananaPanel.getSelectedText();
    if (selection) {
      panel.postMessage({ command: 'selectionChanged', selection });
    }
    return panel;
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.extensionUri = context.extensionUri;
    this.storageManager = new StorageManager(context);
    this.geminiService = new GeminiService();
    this.prePromptService = new PrePromptService(context);

    this.panel.webview.html = this.getHtmlContent();
    this.setupMessageListener();
    this.setupSelectionListener();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private setupMessageListener(): void {
    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.command) {
          case 'ready':
            await this.handleReady();
            break;
          case 'generate':
            await this.handleGenerate(message.prompt, message.prePromptId, message.useSelection);
            break;
          case 'saveApiKey':
            await this.handleSaveApiKey(message.apiKey);
            break;
          case 'deleteApiKey':
            await this.handleDeleteApiKey();
            break;
          case 'downloadImage':
            await this.handleDownload(message.base64, message.filename);
            break;
          case 'openInOS':
            await this.handleOpenInOS(message.base64);
            break;
          case 'addPrePrompt':
            await this.handleAddPrePrompt(message.name, message.prompt);
            break;
          case 'deletePrePrompt':
            await this.handleDeletePrePrompt(message.id);
            break;
          case 'getSelection':
            this.handleGetSelection();
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private setupSelectionListener(): void {
    vscode.window.onDidChangeTextEditorSelection(
      () => {
        const selection = NanoBananaPanel.getSelectedText();
        this.postMessage({ command: 'selectionChanged', selection });
      },
      null,
      this.disposables
    );
  }

  private async handleReady(): Promise<void> {
    const hasApiKey = await this.storageManager.hasApiKey();
    const prePrompts = this.prePromptService.getAllPrePrompts();
    const selection = NanoBananaPanel.getSelectedText();
    const config = vscode.workspace.getConfiguration('nanobanana');

    if (hasApiKey) {
      const apiKey = await this.storageManager.getApiKey();
      if (apiKey) {
        this.geminiService.initialize(apiKey);
      }
    }

    this.postMessage({
      command: 'init',
      hasApiKey,
      prePrompts,
      selection,
      config: {
        aspectRatio: config.get<string>('defaultAspectRatio') || '16:9',
        model: config.get<string>('defaultModel') || 'gemini-3-pro-image-preview',
      },
    });
  }

  private async handleGenerate(
    userContent: string,
    prePromptId: string,
    useSelection: boolean
  ): Promise<void> {
    try {
      this.postMessage({ command: 'generating' });

      if (!this.geminiService.isInitialized()) {
        const apiKey = await this.storageManager.getApiKey();
        if (!apiKey) {
          throw new Error('Please set your Gemini API key first.');
        }
        this.geminiService.initialize(apiKey);
      }

      const prePrompt = this.prePromptService.getPrePromptById(prePromptId);
      if (!prePrompt) {
        throw new Error('Selected diagram type not found.');
      }

      let content = userContent;
      if (useSelection) {
        const selection = NanoBananaPanel.getSelectedText();
        if (selection) {
          content = selection.text;
        }
      }

      if (!content.trim()) {
        throw new Error('Please enter a description for your diagram.');
      }

      const config = vscode.workspace.getConfiguration('nanobanana');
      const image = await this.geminiService.generateDiagram(prePrompt.prompt, content, {
        aspectRatio: config.get<string>('defaultAspectRatio') || '16:9',
        model: config.get<string>('defaultModel') || 'gemini-3-pro-image-preview',
      });

      this.postMessage({ command: 'generated', image });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      this.postMessage({ command: 'error', message });
    }
  }

  private async handleSaveApiKey(apiKey: string): Promise<void> {
    try {
      await this.storageManager.setApiKey(apiKey);
      this.geminiService.initialize(apiKey);
      this.postMessage({ command: 'apiKeyUpdated', hasApiKey: true });
      vscode.window.showInformationMessage('Gemini API key saved successfully!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save API key';
      this.postMessage({ command: 'error', message });
    }
  }

  private async handleDeleteApiKey(): Promise<void> {
    try {
      await this.storageManager.deleteApiKey();
      this.postMessage({ command: 'apiKeyUpdated', hasApiKey: false });
      vscode.window.showInformationMessage('Gemini API key removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete API key';
      this.postMessage({ command: 'error', message });
    }
  }

  private async handleDownload(base64: string, filename: string): Promise<void> {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(filename),
        filters: { Images: ['png'] },
      });

      if (uri) {
        const buffer = Buffer.from(base64, 'base64');
        await vscode.workspace.fs.writeFile(uri, buffer);
        vscode.window.showInformationMessage(`Diagram saved to ${uri.fsPath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save diagram';
      vscode.window.showErrorMessage(message);
    }
  }

  private async handleOpenInOS(base64: string): Promise<void> {
    try {
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `nanobanana_${Date.now()}.png`);
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(tempFile, buffer);
      await vscode.env.openExternal(vscode.Uri.file(tempFile));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open diagram';
      vscode.window.showErrorMessage(message);
    }
  }

  private async handleAddPrePrompt(name: string, prompt: string): Promise<void> {
    try {
      await this.prePromptService.addPrePrompt(name, prompt);
      const prePrompts = this.prePromptService.getAllPrePrompts();
      this.postMessage({ command: 'prePromptsUpdated', prePrompts });
      vscode.window.showInformationMessage(`Diagram type "${name}" added!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add diagram type';
      this.postMessage({ command: 'error', message });
    }
  }

  private async handleDeletePrePrompt(id: string): Promise<void> {
    try {
      const deleted = await this.prePromptService.deletePrePrompt(id);
      if (!deleted) {
        throw new Error('Cannot delete default diagram types.');
      }
      const prePrompts = this.prePromptService.getAllPrePrompts();
      this.postMessage({ command: 'prePromptsUpdated', prePrompts });
      vscode.window.showInformationMessage('Diagram type deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete diagram type';
      this.postMessage({ command: 'error', message });
    }
  }

  private handleGetSelection(): void {
    const selection = NanoBananaPanel.getSelectedText();
    this.postMessage({ command: 'selectionChanged', selection });
  }

  private static getSelectedText(): SelectionInfo | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      return null;
    }

    const text = editor.document.getText(selection);
    const lines = text.split('\n');
    const limitedLines = lines.slice(0, 100);

    return {
      text: limitedLines.join('\n'),
      lineCount: Math.min(lines.length, 100),
    };
  }

  private postMessage(message: ExtensionMessage): void {
    this.panel.webview.postMessage(message);
  }

  private getHtmlContent(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Nano Banana</title>
  <style>
    :root {
      --container-padding: 20px;
      --input-padding: 8px 12px;
      --border-radius: 4px;
    }

    * {
      box-sizing: border-box;
    }

    body {
      padding: var(--container-padding);
      color: var(--vscode-foreground);
      font-size: var(--vscode-font-size);
      font-family: var(--vscode-font-family);
      background-color: var(--vscode-editor-background);
      line-height: 1.5;
    }

    h1 {
      font-size: 1.5em;
      margin: 0 0 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    h2 {
      font-size: 1.1em;
      margin: 0 0 12px 0;
      color: var(--vscode-descriptionForeground);
    }

    .hidden { display: none !important; }

    section {
      margin-bottom: 24px;
    }

    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
    }

    input[type="text"],
    input[type="password"],
    textarea,
    select {
      width: 100%;
      padding: var(--input-padding);
      border: 1px solid var(--vscode-input-border);
      border-radius: var(--border-radius);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: inherit;
    }

    input:focus,
    textarea:focus,
    select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    textarea {
      min-height: 100px;
      resize: vertical;
    }

    button {
      padding: 8px 16px;
      border: none;
      border-radius: var(--border-radius);
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      transition: background-color 0.1s;
    }

    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button.secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    button.danger {
      background-color: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }

    button.icon-btn {
      padding: 6px 10px;
      font-size: 1.1em;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .form-row > * {
      flex: 1;
    }

    .form-row > button {
      flex: none;
    }

    .btn-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .selection-indicator {
      padding: 8px 12px;
      background-color: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      border-radius: var(--border-radius);
      margin-bottom: 12px;
      font-size: 0.9em;
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 16px;
    }

    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid var(--vscode-editor-background);
      border-top: 4px solid var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .result {
      text-align: center;
    }

    .result img {
      max-width: 100%;
      border-radius: var(--border-radius);
      border: 1px solid var(--vscode-panel-border);
      margin-bottom: 16px;
    }

    .error {
      padding: 12px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: var(--border-radius);
      color: var(--vscode-inputValidation-errorForeground);
      margin-bottom: 16px;
    }

    .link {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }

    .link:hover {
      text-decoration: underline;
    }

    .divider {
      height: 1px;
      background-color: var(--vscode-panel-border);
      margin: 20px 0;
    }

    .api-key-section {
      padding: 20px;
      background-color: var(--vscode-sideBar-background);
      border-radius: var(--border-radius);
      border: 1px solid var(--vscode-panel-border);
    }

    .settings-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .settings-row:last-child {
      border-bottom: none;
    }

    /* Add Pre-Prompt Modal */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    .modal {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: var(--border-radius);
      padding: 20px;
      width: 90%;
      max-width: 500px;
    }

    .modal h2 {
      margin-top: 0;
    }
  </style>
</head>
<body>
  <h1>Nano Banana</h1>

  <!-- API Key Setup Section -->
  <section id="api-setup" class="api-key-section">
    <h2>Setup Your Gemini API Key</h2>
    <p>To generate diagrams, you need a Gemini API key from Google AI Studio.</p>
    <div class="form-group">
      <input type="password" id="api-key-input" placeholder="Enter your Gemini API key">
    </div>
    <div class="btn-group">
      <button id="save-key-btn">Save Key</button>
      <a class="link" href="https://aistudio.google.com/apikey" target="_blank">Get API Key</a>
    </div>
  </section>

  <!-- Main Generator Section -->
  <section id="generator" class="hidden">
    <!-- Diagram Type Selector -->
    <div class="form-group">
      <label for="preprompt-select">Diagram Type</label>
      <div class="form-row">
        <select id="preprompt-select"></select>
        <button id="add-preprompt-btn" class="icon-btn secondary" title="Add custom diagram type">+</button>
        <button id="delete-preprompt-btn" class="icon-btn danger hidden" title="Delete diagram type">×</button>
      </div>
    </div>

    <!-- Selection Indicator -->
    <div id="selection-indicator" class="selection-indicator hidden">
      <strong>Selected Text:</strong> <span id="line-count">0</span> lines selected
    </div>

    <!-- Prompt Input -->
    <div class="form-group">
      <label for="prompt-input">Description</label>
      <textarea id="prompt-input" placeholder="Describe your diagram... (e.g., 'User authentication flow with login, 2FA, and session management')"></textarea>
    </div>

    <!-- Generate Buttons -->
    <div class="btn-group">
      <button id="generate-btn">Generate Diagram</button>
      <button id="generate-selection-btn" class="hidden">Generate from Selection</button>
    </div>

    <!-- Loading State -->
    <div id="loading" class="loading hidden">
      <div class="spinner"></div>
      <p>Generating your diagram...</p>
    </div>

    <!-- Error Display -->
    <div id="error" class="error hidden"></div>

    <!-- Result Display -->
    <div id="result" class="result hidden">
      <img id="generated-image" alt="Generated diagram">
      <div class="btn-group" style="justify-content: center;">
        <button id="download-btn">Download</button>
        <button id="open-os-btn" class="secondary">Open in OS</button>
        <button id="regenerate-btn" class="secondary">Regenerate</button>
      </div>
    </div>

    <div class="divider"></div>

    <!-- Settings -->
    <div class="settings-row">
      <span>API Key</span>
      <button id="change-key-btn" class="secondary">Change Key</button>
    </div>
  </section>

  <!-- Add Pre-Prompt Modal -->
  <div id="add-modal" class="modal-overlay hidden">
    <div class="modal">
      <h2>Add Custom Diagram Type</h2>
      <div class="form-group">
        <label for="new-preprompt-name">Name</label>
        <input type="text" id="new-preprompt-name" placeholder="e.g., Data Flow Diagram">
      </div>
      <div class="form-group">
        <label for="new-preprompt-prompt">Prompt Template</label>
        <textarea id="new-preprompt-prompt" placeholder="e.g., data flow diagram, processes, data stores, external entities, arrows showing data movement"></textarea>
      </div>
      <div class="btn-group">
        <button id="save-preprompt-btn">Save</button>
        <button id="cancel-preprompt-btn" class="secondary">Cancel</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // State
      let state = {
        hasApiKey: false,
        prePrompts: [],
        selection: null,
        currentImage: null,
        config: { aspectRatio: '16:9', model: 'gemini-3-pro-image-preview' }
      };

      // Elements
      const el = {
        apiSetup: document.getElementById('api-setup'),
        generator: document.getElementById('generator'),
        apiKeyInput: document.getElementById('api-key-input'),
        saveKeyBtn: document.getElementById('save-key-btn'),
        changeKeyBtn: document.getElementById('change-key-btn'),
        prepromptSelect: document.getElementById('preprompt-select'),
        addPrepromptBtn: document.getElementById('add-preprompt-btn'),
        deletePrepromptBtn: document.getElementById('delete-preprompt-btn'),
        selectionIndicator: document.getElementById('selection-indicator'),
        lineCount: document.getElementById('line-count'),
        promptInput: document.getElementById('prompt-input'),
        generateBtn: document.getElementById('generate-btn'),
        generateSelectionBtn: document.getElementById('generate-selection-btn'),
        loading: document.getElementById('loading'),
        error: document.getElementById('error'),
        result: document.getElementById('result'),
        generatedImage: document.getElementById('generated-image'),
        downloadBtn: document.getElementById('download-btn'),
        openOsBtn: document.getElementById('open-os-btn'),
        regenerateBtn: document.getElementById('regenerate-btn'),
        addModal: document.getElementById('add-modal'),
        newPrepromptName: document.getElementById('new-preprompt-name'),
        newPrepromptPrompt: document.getElementById('new-preprompt-prompt'),
        savePrepromptBtn: document.getElementById('save-preprompt-btn'),
        cancelPrepromptBtn: document.getElementById('cancel-preprompt-btn'),
      };

      // Update UI based on state
      function updateUI() {
        el.apiSetup.classList.toggle('hidden', state.hasApiKey);
        el.generator.classList.toggle('hidden', !state.hasApiKey);

        // Update pre-prompts dropdown
        el.prepromptSelect.innerHTML = state.prePrompts.map(p =>
          '<option value="' + p.id + '">' + p.name + '</option>'
        ).join('');

        // Update delete button visibility
        const selectedId = el.prepromptSelect.value;
        const isDefault = state.prePrompts.find(p => p.id === selectedId)?.isDefault ?? true;
        el.deletePrepromptBtn.classList.toggle('hidden', isDefault);

        // Update selection indicator
        if (state.selection) {
          el.selectionIndicator.classList.remove('hidden');
          el.lineCount.textContent = state.selection.lineCount;
          el.generateSelectionBtn.classList.remove('hidden');
          el.generateSelectionBtn.textContent = 'Generate from Selection (' + state.selection.lineCount + ' lines)';
        } else {
          el.selectionIndicator.classList.add('hidden');
          el.generateSelectionBtn.classList.add('hidden');
        }
      }

      function showLoading() {
        el.loading.classList.remove('hidden');
        el.error.classList.add('hidden');
        el.result.classList.add('hidden');
        el.generateBtn.disabled = true;
        el.generateSelectionBtn.disabled = true;
      }

      function hideLoading() {
        el.loading.classList.add('hidden');
        el.generateBtn.disabled = false;
        el.generateSelectionBtn.disabled = false;
      }

      function showError(message) {
        hideLoading();
        el.error.textContent = message;
        el.error.classList.remove('hidden');
        el.result.classList.add('hidden');
      }

      function showResult(image) {
        hideLoading();
        el.error.classList.add('hidden');
        state.currentImage = image;
        el.generatedImage.src = 'data:' + image.mimeType + ';base64,' + image.base64;
        el.result.classList.remove('hidden');
      }

      // Event listeners
      el.saveKeyBtn.addEventListener('click', () => {
        const apiKey = el.apiKeyInput.value.trim();
        if (apiKey) {
          vscode.postMessage({ command: 'saveApiKey', apiKey });
        }
      });

      el.changeKeyBtn.addEventListener('click', () => {
        state.hasApiKey = false;
        el.apiKeyInput.value = '';
        updateUI();
      });

      el.prepromptSelect.addEventListener('change', updateUI);

      el.addPrepromptBtn.addEventListener('click', () => {
        el.addModal.classList.remove('hidden');
        el.newPrepromptName.value = '';
        el.newPrepromptPrompt.value = '';
      });

      el.deletePrepromptBtn.addEventListener('click', () => {
        const selectedId = el.prepromptSelect.value;
        if (selectedId && confirm('Delete this diagram type?')) {
          vscode.postMessage({ command: 'deletePrePrompt', id: selectedId });
        }
      });

      el.generateBtn.addEventListener('click', () => {
        const prompt = el.promptInput.value.trim();
        const prePromptId = el.prepromptSelect.value;
        if (prompt) {
          vscode.postMessage({ command: 'generate', prompt, prePromptId, useSelection: false });
        }
      });

      el.generateSelectionBtn.addEventListener('click', () => {
        const prePromptId = el.prepromptSelect.value;
        vscode.postMessage({ command: 'generate', prompt: '', prePromptId, useSelection: true });
      });

      el.downloadBtn.addEventListener('click', () => {
        if (state.currentImage) {
          const filename = 'diagram_' + Date.now() + '.png';
          vscode.postMessage({ command: 'downloadImage', base64: state.currentImage.base64, filename });
        }
      });

      el.openOsBtn.addEventListener('click', () => {
        if (state.currentImage) {
          vscode.postMessage({ command: 'openInOS', base64: state.currentImage.base64 });
        }
      });

      el.regenerateBtn.addEventListener('click', () => {
        el.generateBtn.click();
      });

      el.savePrepromptBtn.addEventListener('click', () => {
        const name = el.newPrepromptName.value.trim();
        const prompt = el.newPrepromptPrompt.value.trim();
        if (name && prompt) {
          vscode.postMessage({ command: 'addPrePrompt', name, prompt });
          el.addModal.classList.add('hidden');
        }
      });

      el.cancelPrepromptBtn.addEventListener('click', () => {
        el.addModal.classList.add('hidden');
      });

      // Handle messages from extension
      window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
          case 'init':
            state.hasApiKey = message.hasApiKey;
            state.prePrompts = message.prePrompts;
            state.selection = message.selection;
            state.config = message.config;
            updateUI();
            break;
          case 'generating':
            showLoading();
            break;
          case 'generated':
            showResult(message.image);
            break;
          case 'error':
            showError(message.message);
            break;
          case 'prePromptsUpdated':
            state.prePrompts = message.prePrompts;
            updateUI();
            break;
          case 'selectionChanged':
            state.selection = message.selection;
            updateUI();
            break;
          case 'apiKeyUpdated':
            state.hasApiKey = message.hasApiKey;
            updateUI();
            break;
        }
      });

      // Tell extension we're ready
      vscode.postMessage({ command: 'ready' });
    })();
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    NanoBananaPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
