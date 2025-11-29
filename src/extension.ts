import * as vscode from 'vscode';
import { NanoBananaPanel } from './webview/NanoBananaPanel';
import { StorageManager } from './storage/storageManager';

export function activate(context: vscode.ExtensionContext): void {
  console.log('Nano Banana extension is now active');

  const storageManager = new StorageManager(context);

  // Register command to open the main panel
  const openCommand = vscode.commands.registerCommand('nanobanana.open', () => {
    NanoBananaPanel.createOrShow(context);
  });

  // Register command to generate with selection
  const generateWithSelectionCommand = vscode.commands.registerCommand(
    'nanobanana.generateWithSelection',
    () => {
      NanoBananaPanel.createWithSelection(context);
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

  context.subscriptions.push(openCommand, generateWithSelectionCommand, setApiKeyCommand);
}

export function deactivate(): void {
  console.log('Nano Banana extension is now deactivated');
}
