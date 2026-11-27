import { defineConfig } from '@u1in/loom-core';
import preflight from '@u1in/loom-plugin-preflight';
export default defineConfig({
  version: 1,
  skills: [
    { name: 'pr-review', source: 'src/skills/pr-review' },
    { name: 'release-notes', source: 'src/skills/release-notes' },
  ],
  commonNotice: { file: 'partials/notice.md' },
  variables: { PROJECT_NAME: 'Loom Demo' },
  injections: {
    text: [{ id: 'footer', position: 'bottom', content: 'Built for {{PROJECT_NAME}}.' }],
    metadata: [{ path: 'category', value: 'demo' }],
  },
  plugins: [preflight({ tools: [{ name: 'git', version: '>=2.30', required: true }] })],
  replacements: [{ search: 'EXAMPLE_PROJECT', replace: 'Loom Demo' }],
});
