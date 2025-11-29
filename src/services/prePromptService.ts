import * as vscode from 'vscode';
import type { PrePrompt } from '../types';

const STORAGE_KEY = 'nanobanana.customPrePrompts';

const DEFAULT_PREPROMPTS: PrePrompt[] = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    prompt: 'clean flowchart diagram, boxes and arrows, clear labels, professional technical illustration, white background',
    isDefault: true,
  },
  {
    id: 'sequence',
    name: 'Sequence Diagram',
    prompt: 'UML sequence diagram, lifelines, messages, activations, professional technical diagram, white background',
    isDefault: true,
  },
  {
    id: 'architecture',
    name: 'Architecture Diagram',
    prompt: 'software architecture diagram, components, connections, layers, clean technical illustration, white background',
    isDefault: true,
  },
  {
    id: 'er-diagram',
    name: 'ER Diagram',
    prompt: 'entity-relationship diagram, tables, relationships, cardinality notation, database schema, white background',
    isDefault: true,
  },
  {
    id: 'mindmap',
    name: 'Mind Map',
    prompt: 'mind map diagram, central topic with branching subtopics, colorful nodes, organic connections',
    isDefault: true,
  },
  {
    id: 'network',
    name: 'Network Diagram',
    prompt: 'network topology diagram, nodes, connections, servers, clients, infrastructure illustration, white background',
    isDefault: true,
  },
  {
    id: 'class-diagram',
    name: 'Class Diagram',
    prompt: 'UML class diagram, classes with attributes and methods, inheritance arrows, associations, white background',
    isDefault: true,
  },
  {
    id: 'state-machine',
    name: 'State Machine',
    prompt: 'state machine diagram, states as circles, transitions as arrows, initial and final states, white background',
    isDefault: true,
  },
];

export class PrePromptService {
  constructor(private context: vscode.ExtensionContext) {}

  getAllPrePrompts(): PrePrompt[] {
    const custom = this.context.globalState.get<PrePrompt[]>(STORAGE_KEY) || [];
    return [...DEFAULT_PREPROMPTS, ...custom];
  }

  getPrePromptById(id: string): PrePrompt | undefined {
    return this.getAllPrePrompts().find((p) => p.id === id);
  }

  async addPrePrompt(name: string, prompt: string): Promise<PrePrompt> {
    const custom = this.context.globalState.get<PrePrompt[]>(STORAGE_KEY) || [];

    const newPrePrompt: PrePrompt = {
      id: `custom_${Date.now()}`,
      name,
      prompt,
      isDefault: false,
    };

    await this.context.globalState.update(STORAGE_KEY, [...custom, newPrePrompt]);
    return newPrePrompt;
  }

  async deletePrePrompt(id: string): Promise<boolean> {
    const custom = this.context.globalState.get<PrePrompt[]>(STORAGE_KEY) || [];
    const prePrompt = custom.find((p) => p.id === id);

    if (!prePrompt) {
      return false;
    }

    if (prePrompt.isDefault) {
      return false;
    }

    await this.context.globalState.update(
      STORAGE_KEY,
      custom.filter((p) => p.id !== id)
    );
    return true;
  }

  isDefaultPrePrompt(id: string): boolean {
    return DEFAULT_PREPROMPTS.some((p) => p.id === id);
  }
}
