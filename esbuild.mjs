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
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
} else {
  await Promise.all([extensionContext.rebuild(), webviewContext.rebuild()]);
  await Promise.all([extensionContext.dispose(), webviewContext.dispose()]);
}
