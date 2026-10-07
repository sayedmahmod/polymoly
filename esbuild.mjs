import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const extensionContext = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
});

// Stdio MCP server the CLI agents load to start subagents; runs outside the extension host.
const subagentMcpContext = await esbuild.context({
  entryPoints: ['src/agents/mcpServer.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/subagent-mcp.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
});

const webviewContext = await esbuild.context({
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: 'dist/webview.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
});

if (watch) {
  await Promise.all([extensionContext.watch(), subagentMcpContext.watch(), webviewContext.watch()]);
} else {
  await Promise.all([extensionContext.rebuild(), subagentMcpContext.rebuild(), webviewContext.rebuild()]);
  await Promise.all([extensionContext.dispose(), subagentMcpContext.dispose(), webviewContext.dispose()]);
}
