// Builds the Apps Script files: GradingCore.gs (shared engine bundle) and Code.gs.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
mkdirSync(out, { recursive: true });
const clientId = process.env.ILP_GOOGLE_CLIENT_ID ?? '__CLIENT_ID__';
const r = await build({
  entryPoints: [join(here, 'src/core-entry.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'ILP',
  target: 'es2019',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  minify: true,
  write: false,
  legalComments: 'none',
  plugins: [{
    // zod ships ~40 error-message locales; the broker only needs English.
    name: 'zod-english-only',
    setup(b) {
      b.onLoad({ filter: /zod.v4.locales.[a-zA-Z-]+\.js$/ }, (args) =>
        /[\\/](en|index)\.js$/.test(args.path) ? undefined : { contents: 'export default function () { return {}; }', loader: 'js' });
    },
  }],
});
const core = readFileSync(join(here, 'src/polyfills.js'), 'utf8') + '\n' + r.outputFiles[0].text;
writeFileSync(join(out, 'GradingCore.gs'), `/* Interactive Learning Platform grading engine (MIT). Generated — do not edit. */\n${core}`);
writeFileSync(join(out, 'Code.gs'), readFileSync(join(here, 'src/Code.js'), 'utf8').replace("'__CLIENT_ID__'", JSON.stringify(clientId)));
copyFileSync(join(here, 'src/appsscript.json'), join(out, 'appsscript.json'));
console.log(`broker built: GradingCore.gs ${(core.length / 1024).toFixed(0)} KB, Code.gs`);
