import * as vscode from 'vscode';
import { NanoBananaViewProvider } from './webview/NanoBananaPanel';
import { StorageManager } from './storage/storageManager';

export function activate(context: vscode.ExtensionContext): void {
  console.log('Nano Banana extension is now active');

  const storageManager = new StorageManager(context);
  const provider = new NanoBananaViewProvider(context);

  // Register the webview view provider for the sidebar
  const viewProvider = vscode.window.registerWebviewViewProvider(
    NanoBananaViewProvider.viewType,
    provider
  );

  // Register command to focus the sidebar view
  const openCommand = vscode.commands.registerCommand('nanobanana.open', () => {
    vscode.commands.executeCommand('nanobanana.view.focus');
  });

  // Register command to generate with selection
  const generateWithSelectionCommand = vscode.commands.registerCommand(
    'nanobanana.generateWithSelection',
    () => {
      vscode.commands.executeCommand('nanobanana.view.focus');
      provider.sendSelectionUpdate();
    }
  );

  // Register command to set API key
  const setApiKeyCommand = vscode.commands.registerCommand('nanobanana.setApiKey', async () => {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your Gemini API key',
      password: true,
      placeHolder: 'API key from Google AI Studio',
      ignoreFocusOut: true,
    });

    if (apiKey) {
      await storageManager.setApiKey(apiKey);
      vscode.window.showInformationMessage('Gemini API key saved successfully!');
    }
  });

  context.subscriptions.push(
    viewProvider,
    openCommand,
    generateWithSelectionCommand,
    setApiKeyCommand
  );
}

export function deactivate(): void {
  console.log('Nano Banana extension is now deactivated');
}
