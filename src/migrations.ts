import * as vscode from 'vscode';

const MIGRATION_VERSION_KEY = 'polyagent.migrationVersion';
const CURRENT_MIGRATION_VERSION = 1;
const CONVERSATIONS_KEY = 'polyagent.conversations';

const LEGACY_SETTING_KEYS = [
  'language',
  'providers',
  'mcpServers',
  'skills.directory',
  'skills.disabled',
  'defaultProvider',
  'fallbackOrder',
  'claude.permissionMode',
  'codex.sandbox',
  'usage.days',
  'usage.autoRefreshMinutes'
] as const;

/**
 * Runs idempotent user-data migrations before the rest of the extension reads
 * configuration or global state.
 */
export async function runMigrations(context: vscode.ExtensionContext): Promise<void> {
  const version = context.globalState.get<number>(MIGRATION_VERSION_KEY, 0);
  if (version >= CURRENT_MIGRATION_VERSION) {
    return;
  }

  try {
    if (version < 1) {
      await preserveLegacyDefaultEffort(context);
    }
    await context.globalState.update(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION);
  } catch (error) {
    // A failed settings write must not prevent PolyMoly from starting. Leave the
    // version untouched so the migration is retried on the next activation.
    console.warn('[PolyMoly] user-data migration failed', error);
  }
}

/**
 * New installs now start at medium effort. Before this change, new conversations
 * implicitly started at high. Existing users who already have PolyMoly settings
 * or saved conversations get an explicit user-level high value so upgrading does
 * not silently alter their behavior.
 */
async function preserveLegacyDefaultEffort(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('polyagent');
  if (hasExplicitSetting(config, 'defaultEffort')) {
    return;
  }

  const conversations = context.globalState.get<unknown[]>(CONVERSATIONS_KEY, []);
  const hasSavedConversations = Array.isArray(conversations) && conversations.length > 0;
  const hasExistingSettings = LEGACY_SETTING_KEYS.some((key) => hasExplicitSetting(config, key));

  if (!hasSavedConversations && !hasExistingSettings) {
    return;
  }

  await config.update('defaultEffort', 'high', vscode.ConfigurationTarget.Global);
}

function hasExplicitSetting(config: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = config.inspect<unknown>(key);
  return Boolean(
    inspected &&
      (inspected.globalValue !== undefined ||
        inspected.workspaceValue !== undefined ||
        inspected.workspaceFolderValue !== undefined)
  );
}
