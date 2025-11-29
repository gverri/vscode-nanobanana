import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { StorageManager } from "../storage/storageManager";
import { GeminiService } from "../services/geminiService";
import { PrePromptService } from "../services/prePromptService";
import type { WebviewMessage, ExtensionMessage, SelectionInfo } from "../types";

export class NanoBananaViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nanobanana.view";

  private view?: vscode.WebviewView;
  private readonly extensionUri: vscode.Uri;
  private readonly storageManager: StorageManager;
  private readonly geminiService: GeminiService;
  private readonly prePromptService: PrePromptService;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.extensionUri = context.extensionUri;
    this.storageManager = new StorageManager(context);
    this.geminiService = new GeminiService();
    this.prePromptService = new PrePromptService(context);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    webviewView.webview.html = this.getHtmlContent();
    this.setupMessageListener();
    this.setupSelectionListener();

    webviewView.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public sendSelectionUpdate(): void {
    const selection = this.getSelectedText();
    this.postMessage({ command: "selectionChanged", selection });
  }

  private setupMessageListener(): void {
    this.view?.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.command) {
          case "ready":
            await this.handleReady();
            break;
          case "generate":
            await this.handleGenerate(
              message.prompt,
              message.prePromptId,
              message.useSelection
            );
            break;
          case "saveApiKey":
            await this.handleSaveApiKey(message.apiKey);
            break;
          case "deleteApiKey":
            await this.handleDeleteApiKey();
            break;
          case "downloadImage":
            await this.handleDownload(message.base64, message.filename);
            break;
          case "openInOS":
            await this.handleOpenInOS(message.base64);
            break;
          case "addPrePrompt":
            await this.handleAddPrePrompt(message.name, message.prompt);
            break;
          case "updatePrePrompt":
            await this.handleUpdatePrePrompt(message.id, message.name, message.prompt);
            break;
          case "deletePrePrompt":
            await this.handleDeletePrePrompt(message.id);
            break;
          case "confirmDeletePrePrompt":
            await this.handleConfirmDeletePrePrompt(message.id);
            break;
          case "getSelection":
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
        const selection = this.getSelectedText();
        this.postMessage({ command: "selectionChanged", selection });
      },
      null,
      this.disposables
    );
  }

  private async handleReady(): Promise<void> {
    const hasApiKey = await this.storageManager.hasApiKey();
    const prePrompts = this.prePromptService.getAllPrePrompts();
    const selection = this.getSelectedText();
    const config = vscode.workspace.getConfiguration("nanobanana");

    if (hasApiKey) {
      const apiKey = await this.storageManager.getApiKey();
      if (apiKey) {
        this.geminiService.initialize(apiKey);
      }
    }

    this.postMessage({
      command: "init",
      hasApiKey,
      prePrompts,
      selection,
      config: {
        aspectRatio: config.get<string>("defaultAspectRatio") || "16:9",
        model:
          config.get<string>("defaultModel") || "gemini-3-pro-image-preview",
      },
    });
  }

  private async handleGenerate(
    userContent: string,
    prePromptId: string,
    useSelection: boolean
  ): Promise<void> {
    try {
      this.postMessage({ command: "generating" });

      if (!this.geminiService.isInitialized()) {
        const apiKey = await this.storageManager.getApiKey();
        if (!apiKey) {
          throw new Error("Please set your Gemini API key first.");
        }
        this.geminiService.initialize(apiKey);
      }

      const prePrompt = this.prePromptService.getPrePromptById(prePromptId);
      if (!prePrompt) {
        throw new Error("Selected diagram type not found.");
      }

      let content = userContent;
      if (useSelection) {
        const selection = this.getSelectedText();
        if (selection) {
          content = selection.text;
        }
      }

      if (!content.trim()) {
        throw new Error("Please enter a description for your diagram.");
      }

      const config = vscode.workspace.getConfiguration("nanobanana");
      const image = await this.geminiService.generateDiagram(
        prePrompt.prompt,
        content,
        {
          aspectRatio: config.get<string>("defaultAspectRatio") || "16:9",
          model:
            config.get<string>("defaultModel") || "gemini-3-pro-image-preview",
        }
      );

      this.postMessage({ command: "generated", image });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "An error occurred";
      this.postMessage({ command: "error", message });
    }
  }

  private async handleSaveApiKey(apiKey: string): Promise<void> {
    try {
      await this.storageManager.setApiKey(apiKey);
      this.geminiService.initialize(apiKey);
      this.postMessage({ command: "apiKeyUpdated", hasApiKey: true });
      vscode.window.showInformationMessage(
        "Gemini API key saved successfully!"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save API key";
      this.postMessage({ command: "error", message });
    }
  }

  private async handleDeleteApiKey(): Promise<void> {
    try {
      await this.storageManager.deleteApiKey();
      this.postMessage({ command: "apiKeyUpdated", hasApiKey: false });
      vscode.window.showInformationMessage("Gemini API key removed.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete API key";
      this.postMessage({ command: "error", message });
    }
  }

  private async handleDownload(
    base64: string,
    filename: string
  ): Promise<void> {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(filename),
        filters: { Images: ["png"] },
      });

      if (uri) {
        const buffer = Buffer.from(base64, "base64");
        await vscode.workspace.fs.writeFile(uri, buffer);
        vscode.window.showInformationMessage(`Diagram saved to ${uri.fsPath}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save diagram";
      vscode.window.showErrorMessage(message);
    }
  }

  private async handleOpenInOS(base64: string): Promise<void> {
    try {
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `nanobanana_${Date.now()}.png`);
      const buffer = Buffer.from(base64, "base64");
      fs.writeFileSync(tempFile, buffer);
      await vscode.env.openExternal(vscode.Uri.file(tempFile));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open diagram";
      vscode.window.showErrorMessage(message);
    }
  }

  private async handleAddPrePrompt(
    name: string,
    prompt: string
  ): Promise<void> {
    try {
      await this.prePromptService.addPrePrompt(name, prompt);
      const prePrompts = this.prePromptService.getAllPrePrompts();
      this.postMessage({ command: "prePromptsUpdated", prePrompts });
      vscode.window.showInformationMessage(`Diagram type "${name}" added!`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to add diagram type";
      this.postMessage({ command: "error", message });
    }
  }

  private async handleDeletePrePrompt(id: string): Promise<void> {
    try {
      const deleted = await this.prePromptService.deletePrePrompt(id);
      if (!deleted) {
        throw new Error("Cannot delete default diagram types.");
      }
      const prePrompts = this.prePromptService.getAllPrePrompts();
      this.postMessage({ command: "prePromptsUpdated", prePrompts });
      vscode.window.showInformationMessage("Diagram type deleted.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete diagram type";
      this.postMessage({ command: "error", message });
    }
  }

  private async handleConfirmDeletePrePrompt(id: string): Promise<void> {
    const prePrompt = this.prePromptService.getPrePromptById(id);
    if (!prePrompt) {
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `Delete "${prePrompt.name}"?`,
      { modal: true },
      "Delete"
    );

    if (answer === "Delete") {
      this.postMessage({ command: "confirmDelete", id });
    }
  }

  private async handleUpdatePrePrompt(
    id: string,
    name: string,
    prompt: string
  ): Promise<void> {
    try {
      const updated = await this.prePromptService.updatePrePrompt(id, name, prompt);
      if (!updated) {
        throw new Error("Cannot update this diagram type.");
      }
      const prePrompts = this.prePromptService.getAllPrePrompts();
      this.postMessage({ command: "prePromptsUpdated", prePrompts });
      vscode.window.showInformationMessage(`Diagram type "${name}" updated!`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update diagram type";
      this.postMessage({ command: "error", message });
    }
  }

  private handleGetSelection(): void {
    const selection = this.getSelectedText();
    this.postMessage({ command: "selectionChanged", selection });
  }

  private getSelectedText(): SelectionInfo | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      return null;
    }

    const text = editor.document.getText(selection);
    const lines = text.split("\n");
    const limitedLines = lines.slice(0, 100);

    return {
      text: limitedLines.join("\n"),
      lineCount: Math.min(lines.length, 100),
    };
  }

  private postMessage(message: ExtensionMessage): void {
    this.view?.webview.postMessage(message);
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
      --spacing-xs: 4px;
      --spacing-sm: 8px;
      --spacing-md: 12px;
      --spacing-lg: 16px;
      --spacing-xl: 20px;
      --spacing-2xl: 24px;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --transition-fast: 120ms ease;
      --transition-normal: 200ms ease;
      --transition-slow: 300ms ease;
      /* Banana Gold Theme */
      --banana-gold: #F5C518;
      --banana-gold-light: #FFE566;
      --banana-gold-glow: rgba(245, 197, 24, 0.3);
      --banana-gold-subtle: rgba(245, 197, 24, 0.15);
      --banana-gold-border: rgba(245, 197, 24, 0.4);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      padding: var(--spacing-lg);
      color: var(--vscode-foreground);
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background-color: var(--vscode-sideBar-background);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Typography */
    .header {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-xl);
      padding-bottom: var(--spacing-md);
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent);
    }

    .header-icon {
      flex-shrink: 0;
    }

    .header-title {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--vscode-foreground);
    }

    .header-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 10px;
      background: var(--banana-gold-subtle);
      color: var(--banana-gold);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: var(--spacing-sm);
    }

    .hidden { display: none !important; }

    /* Sections */
    section {
      margin-bottom: var(--spacing-xl);
    }

    /* Cards */
    .card {
      background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
      border-radius: var(--radius-md);
      padding: var(--spacing-lg);
      transition: border-color var(--transition-normal), background var(--transition-normal);
    }

    .card:hover {
      border-color: color-mix(in srgb, var(--vscode-panel-border) 80%, transparent);
    }

    .card-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: var(--spacing-xs);
      color: var(--vscode-foreground);
    }

    .card-description {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: var(--spacing-md);
      line-height: 1.6;
    }

    /* Form Elements */
    .form-group {
      margin-bottom: var(--spacing-md);
    }

    .form-group:last-child {
      margin-bottom: 0;
    }

    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--vscode-foreground);
      margin-bottom: var(--spacing-xs);
    }

    input[type="text"],
    input[type="password"],
    textarea,
    select {
      width: 100%;
      padding: 10px var(--spacing-md);
      border: 1px solid color-mix(in srgb, var(--vscode-input-border) 70%, transparent);
      border-radius: var(--radius-sm);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: 13px;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    input[type="text"]::placeholder,
    input[type="password"]::placeholder,
    textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
      opacity: 0.6;
    }

    input:hover,
    textarea:hover,
    select:hover {
      border-color: var(--vscode-input-border);
    }

    input:focus,
    textarea:focus,
    select:focus {
      outline: none;
      border-color: var(--banana-gold);
      box-shadow: 0 0 0 3px var(--banana-gold-subtle);
    }

    textarea {
      min-height: 100px;
      resize: vertical;
      line-height: 1.6;
    }

    select {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 36px;
    }

    /* Buttons */
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-xs);
      padding: 9px var(--spacing-md);
      border: none;
      border-radius: var(--radius-sm);
      background: linear-gradient(135deg, var(--banana-gold-light) 0%, var(--banana-gold) 100%);
      color: #1a1a1a;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      transition: all var(--transition-fast);
      position: relative;
      overflow: hidden;
      box-shadow: 0 2px 8px var(--banana-gold-glow);
    }

    button::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, rgba(255,255,255,0.15), rgba(255,255,255,0));
      pointer-events: none;
    }

    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px var(--banana-gold-glow);
      filter: brightness(1.05);
    }

    button:active {
      transform: translateY(0);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    button.secondary {
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, transparent);
      color: var(--vscode-foreground);
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
      box-shadow: none;
    }

    button.secondary::before {
      display: none;
    }

    button.secondary:hover {
      background: color-mix(in srgb, var(--vscode-editor-background) 100%, transparent);
      border-color: var(--banana-gold-border);
      box-shadow: 0 0 0 1px var(--banana-gold-subtle);
      filter: none;
    }

    button.ghost {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      padding: 6px 8px;
      box-shadow: none;
    }

    button.ghost::before {
      display: none;
    }

    button.ghost:hover {
      background: var(--banana-gold-subtle);
      color: var(--banana-gold);
      transform: none;
      filter: none;
    }

    button.danger {
      background: color-mix(in srgb, #ff6b6b 15%, var(--vscode-editor-background));
      color: #ff6b6b;
      box-shadow: none;
      border: 1px solid color-mix(in srgb, #ff6b6b 30%, transparent);
    }

    button.danger:hover {
      background: color-mix(in srgb, #ff6b6b 25%, var(--vscode-editor-background));
      filter: none;
    }

    button.icon-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      flex-shrink: 0;
    }

    button.icon-btn.secondary {
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, transparent);
      color: var(--vscode-foreground);
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
      box-shadow: none;
    }

    button.icon-btn.secondary:hover {
      border-color: var(--banana-gold-border);
      color: var(--banana-gold);
    }

    /* Form Layouts */
    .form-row {
      display: flex;
      gap: var(--spacing-sm);
      align-items: stretch;
    }

    .form-row > *:first-child {
      flex: 1;
    }

    .btn-group {
      display: flex;
      gap: var(--spacing-sm);
    }

    .btn-group-stretch {
      display: flex;
      gap: var(--spacing-sm);
    }

    .btn-group-stretch > button {
      flex: 1;
    }

    /* Selection Indicator */
    .selection-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-xs) var(--spacing-sm);
      background: var(--banana-gold-subtle);
      border: 1px solid var(--banana-gold-border);
      border-radius: 100px;
      font-size: 11px;
      font-weight: 600;
      color: var(--banana-gold);
      margin-bottom: var(--spacing-md);
    }

    .selection-chip-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--banana-gold);
      animation: pulse 2s ease infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Loading State */
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-2xl) var(--spacing-lg);
      gap: var(--spacing-md);
    }

    .spinner {
      width: 28px;
      height: 28px;
      border: 2px solid var(--banana-gold-subtle);
      border-top-color: var(--banana-gold);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    /* Result Display */
    .result {
      animation: fadeIn var(--transition-slow);
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .result-image-container {
      position: relative;
      margin-bottom: var(--spacing-md);
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, transparent);
      transition: border-color var(--transition-normal), box-shadow var(--transition-normal);
    }

    .result-image-container:hover {
      border-color: var(--banana-gold-border);
      box-shadow: 0 0 0 2px var(--banana-gold-subtle);
    }

    .result img {
      display: block;
      width: 100%;
      height: auto;
    }

    .result-actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--spacing-sm);
    }

    /* Error Display */
    .error {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
      background-color: color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 50%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-errorBorder) 60%, transparent);
      border-radius: var(--radius-sm);
      margin-bottom: var(--spacing-md);
      font-size: 12px;
      line-height: 1.5;
      animation: shake 0.4s ease;
    }

    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-4px); }
      40%, 80% { transform: translateX(4px); }
    }

    .error-icon {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      opacity: 0.8;
    }

    /* Links */
    .link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      transition: opacity var(--transition-fast);
    }

    .link:hover {
      opacity: 0.8;
    }

    .link-arrow {
      transition: transform var(--transition-fast);
    }

    .link:hover .link-arrow {
      transform: translateX(2px);
    }

    /* Divider */
    .divider {
      height: 1px;
      background: linear-gradient(to right, transparent, color-mix(in srgb, var(--banana-gold) 30%, var(--vscode-panel-border)), transparent);
      margin: var(--spacing-xl) 0;
    }

    /* Settings Footer */
    .settings-footer {
      padding-top: var(--spacing-md);
    }

    .settings-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-sm) 0;
    }

    .settings-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      animation: fadeIn var(--transition-normal);
      padding: var(--spacing-lg);
    }

    .modal {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-xl);
      width: 100%;
      max-width: 340px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--banana-gold-subtle);
      animation: modalSlide var(--transition-slow) ease;
    }

    @keyframes modalSlide {
      from { opacity: 0; transform: scale(0.95) translateY(-10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .modal-header {
      margin-bottom: var(--spacing-lg);
    }

    .modal-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: var(--spacing-xs);
    }

    .modal-description {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .modal-actions {
      display: flex;
      gap: var(--spacing-sm);
      margin-top: var(--spacing-lg);
    }

    .modal-actions > button {
      flex: 1;
    }

    /* ========================================
       SETUP / ONBOARDING STYLES
       ======================================== */
    .setup-container {
      animation: setupFadeIn 0.6s ease;
    }

    @keyframes setupFadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .setup-hero {
      text-align: center;
      padding: var(--spacing-xl) 0 var(--spacing-2xl);
      position: relative;
    }

    .setup-icon-glow {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -60%);
      width: 120px;
      height: 120px;
      background: radial-gradient(circle, var(--banana-gold-subtle) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
      animation: glowPulse 3s ease-in-out infinite;
    }

    @keyframes glowPulse {
      0%, 100% { opacity: 0.6; transform: translate(-50%, -60%) scale(1); }
      50% { opacity: 1; transform: translate(-50%, -60%) scale(1.1); }
    }

    .setup-icon {
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 4px 12px var(--banana-gold-glow));
      animation: iconFloat 4s ease-in-out infinite;
    }

    @keyframes iconFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }

    .setup-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--vscode-foreground);
      margin: var(--spacing-md) 0 var(--spacing-xs);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    }

    .setup-subtitle {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
      max-width: 260px;
      margin: 0 auto;
    }

    /* Steps */
    .setup-steps {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-lg);
    }

    .setup-step {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md);
      background: linear-gradient(135deg,
        color-mix(in srgb, var(--vscode-editor-background) 80%, transparent) 0%,
        color-mix(in srgb, var(--vscode-editor-background) 60%, transparent) 100%
      );
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent);
      border-radius: var(--radius-md);
      text-decoration: none;
      color: inherit;
      transition: all var(--transition-normal);
      animation: stepSlideIn 0.5s ease backwards;
      animation-delay: calc(var(--delay) * 0.1s + 0.2s);
    }

    @keyframes stepSlideIn {
      from { opacity: 0; transform: translateX(-12px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .setup-step:hover {
      border-color: var(--banana-gold-border);
      background: linear-gradient(135deg,
        color-mix(in srgb, var(--vscode-editor-background) 90%, var(--banana-gold-subtle)) 0%,
        color-mix(in srgb, var(--vscode-editor-background) 70%, transparent) 100%
      );
      transform: translateX(2px);
    }

    a.setup-step {
      cursor: pointer;
    }

    a.setup-step:hover .step-arrow {
      transform: translate(2px, -2px);
      color: var(--banana-gold);
    }

    .step-number {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--banana-gold-light) 0%, var(--banana-gold) 100%);
      color: #1a1a1a;
      font-size: 12px;
      font-weight: 700;
      border-radius: 50%;
      flex-shrink: 0;
      box-shadow: 0 2px 8px var(--banana-gold-glow);
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }

    .step-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 2px;
    }

    .step-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.8;
    }

    .step-arrow {
      flex-shrink: 0;
      color: var(--vscode-descriptionForeground);
      opacity: 0.6;
      transition: all var(--transition-fast);
    }

    /* Note */
    .setup-note {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      background: color-mix(in srgb, var(--banana-gold) 8%, transparent);
      border: 1px dashed color-mix(in srgb, var(--banana-gold) 30%, transparent);
      border-radius: var(--radius-sm);
      font-size: 11px;
      color: color-mix(in srgb, var(--vscode-foreground) 80%, var(--banana-gold));
      margin-bottom: var(--spacing-xl);
      animation: noteAppear 0.5s ease 0.5s backwards;
    }

    @keyframes noteAppear {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .setup-note svg {
      flex-shrink: 0;
      opacity: 0.7;
      color: var(--banana-gold);
    }

    /* Form */
    .setup-form {
      animation: formSlideUp 0.5s ease 0.6s backwards;
    }

    @keyframes formSlideUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .setup-form .form-group {
      margin-bottom: var(--spacing-md);
    }

    .setup-form input {
      background: var(--vscode-input-background);
      border: 1px solid color-mix(in srgb, var(--vscode-input-border) 60%, transparent);
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
      letter-spacing: 0.5px;
    }

    .setup-form input:focus {
      border-color: var(--banana-gold);
      box-shadow: 0 0 0 3px var(--banana-gold-subtle);
    }

    .setup-connect-btn {
      width: 100%;
      padding: 12px var(--spacing-lg);
      background: linear-gradient(135deg, var(--banana-gold-light) 0%, var(--banana-gold) 100%);
      color: #1a1a1a;
      font-weight: 600;
      font-size: 13px;
      border: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all var(--transition-normal);
      box-shadow: 0 2px 12px var(--banana-gold-glow);
      position: relative;
      overflow: hidden;
    }

    .setup-connect-btn::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, rgba(255,255,255,0.2), rgba(255,255,255,0));
      pointer-events: none;
    }

    .setup-connect-btn::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: linear-gradient(
        to bottom right,
        transparent 45%,
        rgba(255,255,255,0.3) 50%,
        transparent 55%
      );
      transform: rotate(45deg) translateX(-100%);
      transition: transform 0.6s ease;
    }

    .setup-connect-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 20px var(--banana-gold-border);
    }

    .setup-connect-btn:hover::after {
      transform: rotate(45deg) translateX(100%);
    }

    .setup-connect-btn:active {
      transform: translateY(0);
    }

    .setup-connect-btn svg {
      margin-right: var(--spacing-xs);
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <svg class="header-icon" width="20" height="20" viewBox="-5 -10 110 135" fill="#F5C518">
      <path d="m77.289 34.43c-0.92578-2.4609-2.3555-4.6758-4.5312-5.7422-3.2734-1.6172-6.4766-1.4375-8.3633-1.0938-1.2109-3.0547-2.6641-5.8945-4.332-8.4141-3.0078-4.543-6.7305-8.0703-11.082-9.9922-6.6797-2.957-10.762-3.582-12.875-1.625-2.1172 1.9688-1.7109 6.0312 0.53906 12.48l0.074219 0.20703c1.8984 5.4453 4.0391 11.562 5.4375 17.918-2.1953-0.5625-5.4375-0.95703-9.6328-0.28125-4.0312 0.64453-6.8438 2.5859-8.6797 5.1758-2.1367 3.0234-2.8828 6.8867-2.6445 10.562 0.21875 3.3438 0.88672 6.3516 1.9297 8.5547 1.1562 2.457 2.8203 4.0391 4.918 4.2812 1.6328 0.1875 2-1.1055 2.582-3.1758 0.72656-2.5938 2.0938-7.4453 4.4492-10.688 1.9258-2.6367 4.668-4.125 8.6055-1.6992 0.007812 6.0547-1.1953 12.07-4.3945 17.676-0.52344 0.92578-1.1367 1.8516-1.8125 2.7812h0.007813l-0.007813 0.007812c-0.67578 0.9375-1.4141 1.8672-2.1875 2.8203-4.9453 6.0078-12.117 10.926-12.137 10.938-0.15625 0.10547-0.29297 0.24219-0.41406 0.39844-0.60156 0.79297-0.4375 1.918 0.35547 2.5117l6.8867 5.1797c0.64844 0.48828 1.5742 0.48047 2.2266-0.0625 0.019531-0.019532 6.2109-5.2383 7.5117-4.6758 1.3984 0.60547 3.1445 1.1172 5.5742 0.80078 2.2617-0.30078 5.1133-1.3438 8.8008-3.7891 3.6875-2.4375 6.625-5.7695 8.8672-9.6875 0.39453 1.2109 0.75781 2.1055 1.1875 2.6016 0.90625 1.0391 1.8633 1.168 2.9141 0.24219 1.2812-1.1133 3.8242-7.3438 5.0938-14.344 0.84375-4.6797 1.1875-9.8008 0.32422-14.117-0.92578-4.6367-2.3945-7.4141-4.4258-9.0078l2.3867-0.42578c1.4805-0.26172 3.0312 1.9922 3.9375 3.3125 0.73828 1.0742 1.2734 1.8516 2.3203 1.9258 1.2734 0.10156 1.9922-0.51953 2.1055-2.0625 0.12891-1.5195-0.15234-5.8555-1.5156-9.4922zm-47.816 53.906-2.2891-1.7188c1.875-1.4258 4.8125-3.7891 7.6484-6.625 0.41797 0.67578 1.1367 1.6875 2.1992 2.6797-1.8164 1.3086-5.2031 3.7773-7.5586 5.6641zm2.7031-37.844c-2.6562 3.6445-4.1328 8.7188-4.9375 11.586-0.30078-0.36719-0.58594-0.85547-0.86328-1.4297-0.85156-1.8008-1.3984-4.3438-1.5859-7.25-0.03125-0.5-0.042968-1.0078-0.03125-1.5078 0 0 4.0391-12.043 18.531-6.332 0.042969 0.375 0.085938 0.75781 0.125 1.125-4.9492-2.0977-8.5859 0.16406-11.238 3.8086zm7.9336-31.426-0.074219-0.20703c-1.7422-4.9883-2.3359-7.875-1.4766-8.668 0 0 11.488 9.9297 13.512 31.32-2.0938 1.0703-3.7891 2.4883-5.0742 3.8008-0.98828-9.3477-4.168-18.453-6.8867-26.246zm25.895 54.398-0.25-0.83594c-0.14844-0.5-0.30469-1.0391-0.48047-1.6016-0.26953-0.88281-0.5625-1.8203-0.88672-2.8008-0.30469-0.91406-0.63672-1.8672-1.0117-2.8359-2.6055-6.8516-6.9062-14.562-14.664-16.668 0.375-0.44531 0.82031-0.92578 1.332-1.4062 3.2891 1.3008 11.258 5.2305 14.039 13.625l0.1875 0.5625c0.41797 1.2734 0.78906 2.3828 1.1133 3.3242 0.40625 1.1641 0.75781 2.0859 1.0938 2.7812 0.32031 0.66797 0.63281 1.125 0.96094 1.3945-0.48047 1.75-0.97266 3.2812-1.4336 4.4609zm3.8164-36.254-2.457 0.4375c-0.070312-0.33203-0.14844-0.69531-0.23047-1.082 0-0.023437-0.007812-0.050781-0.019531-0.074218l0.007813-0.007813c0.76953-1.3008 2.5391-3.707 5.1328-3.75 0.69531 0.74219 1.2422 1.793 1.6758 2.9453 0.39844 1.0547 0.6875 2.1758 0.88672 3.2383-1.2969-1.2031-2.9375-2.0781-4.9961-1.707z" fill-rule="evenodd"/>
    </svg>
    <span class="header-title">Nano Banana</span>
    <span class="header-badge">AI</span>
  </header>

  <!-- API Key Setup Section -->
  <section id="api-setup" class="setup-container">
    <div class="setup-hero">
      <div class="setup-icon-glow"></div>
      <svg class="setup-icon" width="48" height="48" viewBox="-5 -10 110 135" fill="url(#bananaGrad)">
        <defs>
          <linearGradient id="bananaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#FFE566"/>
            <stop offset="100%" style="stop-color:#F5C518"/>
          </linearGradient>
        </defs>
        <path d="m77.289 34.43c-0.92578-2.4609-2.3555-4.6758-4.5312-5.7422-3.2734-1.6172-6.4766-1.4375-8.3633-1.0938-1.2109-3.0547-2.6641-5.8945-4.332-8.4141-3.0078-4.543-6.7305-8.0703-11.082-9.9922-6.6797-2.957-10.762-3.582-12.875-1.625-2.1172 1.9688-1.7109 6.0312 0.53906 12.48l0.074219 0.20703c1.8984 5.4453 4.0391 11.562 5.4375 17.918-2.1953-0.5625-5.4375-0.95703-9.6328-0.28125-4.0312 0.64453-6.8438 2.5859-8.6797 5.1758-2.1367 3.0234-2.8828 6.8867-2.6445 10.562 0.21875 3.3438 0.88672 6.3516 1.9297 8.5547 1.1562 2.457 2.8203 4.0391 4.918 4.2812 1.6328 0.1875 2-1.1055 2.582-3.1758 0.72656-2.5938 2.0938-7.4453 4.4492-10.688 1.9258-2.6367 4.668-4.125 8.6055-1.6992 0.007812 6.0547-1.1953 12.07-4.3945 17.676-0.52344 0.92578-1.1367 1.8516-1.8125 2.7812h0.007813l-0.007813 0.007812c-0.67578 0.9375-1.4141 1.8672-2.1875 2.8203-4.9453 6.0078-12.117 10.926-12.137 10.938-0.15625 0.10547-0.29297 0.24219-0.41406 0.39844-0.60156 0.79297-0.4375 1.918 0.35547 2.5117l6.8867 5.1797c0.64844 0.48828 1.5742 0.48047 2.2266-0.0625 0.019531-0.019532 6.2109-5.2383 7.5117-4.6758 1.3984 0.60547 3.1445 1.1172 5.5742 0.80078 2.2617-0.30078 5.1133-1.3438 8.8008-3.7891 3.6875-2.4375 6.625-5.7695 8.8672-9.6875 0.39453 1.2109 0.75781 2.1055 1.1875 2.6016 0.90625 1.0391 1.8633 1.168 2.9141 0.24219 1.2812-1.1133 3.8242-7.3438 5.0938-14.344 0.84375-4.6797 1.1875-9.8008 0.32422-14.117-0.92578-4.6367-2.3945-7.4141-4.4258-9.0078l2.3867-0.42578c1.4805-0.26172 3.0312 1.9922 3.9375 3.3125 0.73828 1.0742 1.2734 1.8516 2.3203 1.9258 1.2734 0.10156 1.9922-0.51953 2.1055-2.0625 0.12891-1.5195-0.15234-5.8555-1.5156-9.4922zm-47.816 53.906-2.2891-1.7188c1.875-1.4258 4.8125-3.7891 7.6484-6.625 0.41797 0.67578 1.1367 1.6875 2.1992 2.6797-1.8164 1.3086-5.2031 3.7773-7.5586 5.6641zm2.7031-37.844c-2.6562 3.6445-4.1328 8.7188-4.9375 11.586-0.30078-0.36719-0.58594-0.85547-0.86328-1.4297-0.85156-1.8008-1.3984-4.3438-1.5859-7.25-0.03125-0.5-0.042968-1.0078-0.03125-1.5078 0 0 4.0391-12.043 18.531-6.332 0.042969 0.375 0.085938 0.75781 0.125 1.125-4.9492-2.0977-8.5859 0.16406-11.238 3.8086zm7.9336-31.426-0.074219-0.20703c-1.7422-4.9883-2.3359-7.875-1.4766-8.668 0 0 11.488 9.9297 13.512 31.32-2.0938 1.0703-3.7891 2.4883-5.0742 3.8008-0.98828-9.3477-4.168-18.453-6.8867-26.246zm25.895 54.398-0.25-0.83594c-0.14844-0.5-0.30469-1.0391-0.48047-1.6016-0.26953-0.88281-0.5625-1.8203-0.88672-2.8008-0.30469-0.91406-0.63672-1.8672-1.0117-2.8359-2.6055-6.8516-6.9062-14.562-14.664-16.668 0.375-0.44531 0.82031-0.92578 1.332-1.4062 3.2891 1.3008 11.258 5.2305 14.039 13.625l0.1875 0.5625c0.41797 1.2734 0.78906 2.3828 1.1133 3.3242 0.40625 1.1641 0.75781 2.0859 1.0938 2.7812 0.32031 0.66797 0.63281 1.125 0.96094 1.3945-0.48047 1.75-0.97266 3.2812-1.4336 4.4609zm3.8164-36.254-2.457 0.4375c-0.070312-0.33203-0.14844-0.69531-0.23047-1.082 0-0.023437-0.007812-0.050781-0.019531-0.074218l0.007813-0.007813c0.76953-1.3008 2.5391-3.707 5.1328-3.75 0.69531 0.74219 1.2422 1.793 1.6758 2.9453 0.39844 1.0547 0.6875 2.1758 0.88672 3.2383-1.2969-1.2031-2.9375-2.0781-4.9961-1.707z" fill-rule="evenodd"/>
      </svg>
      <h1 class="setup-title">Let's get started</h1>
      <p class="setup-subtitle">Connect your Gemini API key to unlock AI-powered diagram generation</p>
    </div>

    <div class="setup-steps">
      <a href="https://aistudio.google.com" target="_blank" class="setup-step" style="--delay: 0">
        <div class="step-number">1</div>
        <div class="step-content">
          <div class="step-title">Open Google AI Studio</div>
          <div class="step-desc">Visit aistudio.google.com</div>
        </div>
        <svg class="step-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
      </a>

      <div class="setup-step" style="--delay: 1">
        <div class="step-number">2</div>
        <div class="step-content">
          <div class="step-title">Get your API Key</div>
          <div class="step-desc">Click "Get API Key" → Create new key</div>
        </div>
      </div>

      <div class="setup-step" style="--delay: 2">
        <div class="step-number">3</div>
        <div class="step-content">
          <div class="step-title">Create a project</div>
          <div class="step-desc">You may need to create a new project first</div>
        </div>
      </div>
    </div>

    <div class="setup-note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <span>Billing setup may be required for API access</span>
    </div>

    <div class="setup-form">
      <div class="form-group">
        <label for="api-key-input">Paste your API key</label>
        <input type="password" id="api-key-input" placeholder="AIza...">
      </div>
      <button id="save-key-btn" class="setup-connect-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Connect & Start Creating
      </button>
    </div>
  </section>

  <!-- Main Generator Section -->
  <section id="generator" class="hidden">
    <!-- Image Type Selector -->
    <div class="form-group">
      <label for="preprompt-select">Image Type</label>
      <div class="form-row">
        <select id="preprompt-select"></select>
        <button id="add-preprompt-btn" class="icon-btn secondary" title="Add custom type">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button id="edit-preprompt-btn" class="icon-btn secondary hidden" title="Edit type">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button id="delete-preprompt-btn" class="icon-btn danger hidden" title="Delete type">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <!-- Selection Indicator -->
    <div id="selection-indicator" class="selection-chip hidden">
      <span class="selection-chip-dot"></span>
      <span><span id="line-count">0</span> lines selected</span>
    </div>

    <!-- Prompt Input -->
    <div class="form-group">
      <label for="prompt-input">Description</label>
      <textarea id="prompt-input" placeholder="Describe the diagram you want to create..."></textarea>
    </div>

    <!-- Generate Buttons -->
    <div class="btn-group-stretch">
      <button id="generate-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Generate
      </button>
      <button id="generate-selection-btn" class="secondary hidden">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V4h3M4 17v3h3M17 4h3v3M17 20h3v-3"/></svg>
        Selection
      </button>
    </div>

    <!-- Loading State -->
    <div id="loading" class="loading hidden">
      <div class="spinner"></div>
      <span class="loading-text">Creating your diagram...</span>
    </div>

    <!-- Error Display -->
    <div id="error" class="error hidden">
      <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span id="error-text"></span>
    </div>

    <!-- Result Display -->
    <div id="result" class="result hidden">
      <div class="result-image-container">
        <img id="generated-image" alt="Generated diagram">
      </div>
      <div class="result-actions">
        <button id="download-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Save
        </button>
        <button id="open-os-btn" class="secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
          Open
        </button>
        <button id="regenerate-btn" class="secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
          Redo
        </button>
      </div>
    </div>

    <div class="divider"></div>

    <!-- Settings Footer -->
    <div class="settings-footer">
      <div class="settings-row">
        <span class="settings-label">API Connection</span>
        <button id="change-key-btn" class="ghost">Change Key</button>
      </div>
    </div>
  </section>

  <!-- Add/Edit Pre-Prompt Modal -->
  <div id="add-modal" class="modal-overlay hidden">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title" id="modal-title">New Image Type</div>
        <div class="modal-description" id="modal-description">Create a custom template for generating images.</div>
      </div>
      <div class="form-group">
        <label for="new-preprompt-name">Name</label>
        <input type="text" id="new-preprompt-name" placeholder="e.g., Data Flow Diagram">
      </div>
      <div class="form-group">
        <label for="new-preprompt-prompt">Prompt Template</label>
        <textarea id="new-preprompt-prompt" placeholder="Describe the style and structure of this diagram type..."></textarea>
      </div>
      <div class="modal-actions">
        <button id="cancel-preprompt-btn" class="secondary">Cancel</button>
        <button id="save-preprompt-btn">Create Type</button>
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
        config: { aspectRatio: '16:9', model: 'gemini-3-pro-image-preview' },
        editingId: null
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
        editPrepromptBtn: document.getElementById('edit-preprompt-btn'),
        deletePrepromptBtn: document.getElementById('delete-preprompt-btn'),
        selectionIndicator: document.getElementById('selection-indicator'),
        lineCount: document.getElementById('line-count'),
        promptInput: document.getElementById('prompt-input'),
        generateBtn: document.getElementById('generate-btn'),
        generateSelectionBtn: document.getElementById('generate-selection-btn'),
        loading: document.getElementById('loading'),
        error: document.getElementById('error'),
        errorText: document.getElementById('error-text'),
        result: document.getElementById('result'),
        generatedImage: document.getElementById('generated-image'),
        downloadBtn: document.getElementById('download-btn'),
        openOsBtn: document.getElementById('open-os-btn'),
        regenerateBtn: document.getElementById('regenerate-btn'),
        addModal: document.getElementById('add-modal'),
        modalTitle: document.getElementById('modal-title'),
        modalDescription: document.getElementById('modal-description'),
        newPrepromptName: document.getElementById('new-preprompt-name'),
        newPrepromptPrompt: document.getElementById('new-preprompt-prompt'),
        savePrepromptBtn: document.getElementById('save-preprompt-btn'),
        cancelPrepromptBtn: document.getElementById('cancel-preprompt-btn'),
      };

      // Rebuild dropdown only when prePrompts change
      function updateDropdown() {
        const currentValue = el.prepromptSelect.value;
        el.prepromptSelect.innerHTML = state.prePrompts.map(p =>
          '<option value="' + p.id + '">' + p.name + '</option>'
        ).join('');
        // Restore selection if it still exists
        if (currentValue && state.prePrompts.some(p => p.id === currentValue)) {
          el.prepromptSelect.value = currentValue;
        }
        updateTypeButtons();
      }

      // Update edit/delete buttons based on current selection
      function updateTypeButtons() {
        const selectedId = el.prepromptSelect.value;
        const isDefault = state.prePrompts.find(p => p.id === selectedId)?.isDefault ?? true;
        el.editPrepromptBtn.classList.toggle('hidden', isDefault);
        el.deletePrepromptBtn.classList.toggle('hidden', isDefault);
      }

      // Update UI based on state
      function updateUI() {
        el.apiSetup.classList.toggle('hidden', state.hasApiKey);
        el.generator.classList.toggle('hidden', !state.hasApiKey);

        // Update selection indicator
        if (state.selection) {
          el.selectionIndicator.classList.remove('hidden');
          el.lineCount.textContent = state.selection.lineCount;
          el.generateSelectionBtn.classList.remove('hidden');
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
        el.errorText.textContent = message;
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

      el.prepromptSelect.addEventListener('change', updateTypeButtons);

      el.addPrepromptBtn.addEventListener('click', () => {
        state.editingId = null;
        el.modalTitle.textContent = 'New Image Type';
        el.modalDescription.textContent = 'Create a custom template for generating images.';
        el.savePrepromptBtn.textContent = 'Create Type';
        el.newPrepromptName.value = '';
        el.newPrepromptPrompt.value = '';
        el.addModal.classList.remove('hidden');
      });

      el.editPrepromptBtn.addEventListener('click', () => {
        const selectedId = el.prepromptSelect.value;
        const prePrompt = state.prePrompts.find(p => p.id === selectedId);
        if (!prePrompt || prePrompt.isDefault) return;

        state.editingId = selectedId;
        el.modalTitle.textContent = 'Edit Image Type';
        el.modalDescription.textContent = 'Update the template for this image type.';
        el.savePrepromptBtn.textContent = 'Save Changes';
        el.newPrepromptName.value = prePrompt.name;
        el.newPrepromptPrompt.value = prePrompt.prompt;
        el.addModal.classList.remove('hidden');
      });

      el.deletePrepromptBtn.addEventListener('click', () => {
        const selectedId = el.prepromptSelect.value;
        if (selectedId) {
          vscode.postMessage({ command: 'confirmDeletePrePrompt', id: selectedId });
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
          if (state.editingId) {
            vscode.postMessage({ command: 'updatePrePrompt', id: state.editingId, name, prompt });
          } else {
            vscode.postMessage({ command: 'addPrePrompt', name, prompt });
          }
          el.addModal.classList.add('hidden');
          state.editingId = null;
        }
      });

      el.cancelPrepromptBtn.addEventListener('click', () => {
        el.addModal.classList.add('hidden');
        state.editingId = null;
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
            updateDropdown();
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
            updateDropdown();
            break;
          case 'selectionChanged':
            state.selection = message.selection;
            updateUI();
            break;
          case 'apiKeyUpdated':
            state.hasApiKey = message.hasApiKey;
            updateUI();
            break;
          case 'confirmDelete':
            vscode.postMessage({ command: 'deletePrePrompt', id: message.id });
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
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
