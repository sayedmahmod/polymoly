import * as vscode from 'vscode';
import { AgentAdapter, ProviderDef } from '../types';
import { CliAdapter } from './cliAdapter';
import { HttpAdapter } from './httpAdapter';
import { apiKeySecret } from './registry';

export function createAdapter(def: ProviderDef, secrets: vscode.SecretStorage): AgentAdapter {
  if (def.kind === 'cli') {
    return new CliAdapter(def, async (id) => secrets.get(apiKeySecret(id)));
  }
  return new HttpAdapter(def, async (id) => secrets.get(apiKeySecret(id)));
}

export { loadProviders, findProvider, apiKeySecret, adminKeySecret } from './registry';
