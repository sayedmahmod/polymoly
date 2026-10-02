import * as vscode from 'vscode';
import { ConversationStore } from './chat/session';
import { adminKeySecret, apiKeySecret, loadProviders } from './providers/registry';
import { UsageService } from './usage/usageService';
import { ChatViewProvider } from './views/chatViewProvider';
import { UsagePanel } from './views/usagePanel';
import { t } from './i18n';
import { runMigrations } from './migrations';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await runMigrations(context);

  const store = new ConversationStore(context.globalState);
  const usagePanel = new UsagePanel(context, new UsageService(context.secrets, context.globalState));
  const chat = new ChatViewProvider(context, store, usagePanel);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('polyagent.newChat', () => chat.newChat()),
    vscode.commands.registerCommand('polyagent.openUsage', () => usagePanel.show()),
    vscode.commands.registerCommand('polyagent.setApiKey', (providerId?: string) =>
      storeKey(context, 'api', providerId)
    ),
    vscode.commands.registerCommand('polyagent.setAdminKey', (providerId?: string) =>
      storeKey(context, 'admin', providerId)
    ),
    vscode.commands.registerCommand('polyagent.clearKeys', () => clearKeys(context)),
    vscode.commands.registerCommand('polyagent.editProviders', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'polyagent.providers')
    ),
    { dispose: () => usagePanel.dispose() }
  );
}

export function deactivate(): void {
  /* nothing to clean up beyond the subscriptions */
}

async function pickProviderId(placeHolder: string): Promise<string | undefined> {
  const items = loadProviders().map((p) => ({
    label: p.label,
    description: p.id,
    detail: p.description,
    id: p.id
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder });
  return picked?.id;
}

async function storeKey(
  context: vscode.ExtensionContext,
  which: 'api' | 'admin',
  providerId?: string
): Promise<void> {
  const id =
    providerId ??
    (await pickProviderId(which === 'api' ? t('cmd.pickApi') : t('cmd.pickAdmin')));
  if (!id) {
    return;
  }
  const value = await vscode.window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    title: which === 'api' ? t('cmd.apiKeyFor', { id }) : t('cmd.adminKeyFor', { id }),
    prompt:
      which === 'api'
        ? t('cmd.apiKeyPrompt')
        : t('cmd.adminKeyPrompt')
  });
  if (value === undefined) {
    return;
  }
  const key = which === 'api' ? apiKeySecret(id) : adminKeySecret(id);
  if (value === '') {
    await context.secrets.delete(key);
    vscode.window.showInformationMessage(t('cmd.keyDeleted', { id }));
    return;
  }
  await context.secrets.store(key, value);
  vscode.window.showInformationMessage(t('cmd.keySaved', { id }));
}

async function clearKeys(context: vscode.ExtensionContext): Promise<void> {
  const id = await pickProviderId(t('cmd.pickClear'));
  if (!id) {
    return;
  }
  await context.secrets.delete(apiKeySecret(id));
  await context.secrets.delete(adminKeySecret(id));
  vscode.window.showInformationMessage(t('cmd.keysDeleted', { id }));
}
