#!/usr/bin/env node
import { cac } from 'cac';
import { loadConfig } from './config';
import { build } from './pipeline';
const cli = cac('loom');
cli
  .command('build', 'Build configured skills')
  .option('--skill <name>', 'Build one skill')
  .option('--out <dir>', 'Override output directory')
  .option('--check', 'Check existing output')
  .option('--check-determinism', 'Build twice and compare output')
  .action(async (options) => {
    try {
      await build(await loadConfig(), { ...options, reloadConfig: () => loadConfig() });
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  });
cli.help();
cli.version('0.4.0');
try {
  cli.parse();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
}
