import { defineConfig } from '@u1in/loom-core';
import { installDoc } from '@u1in/loom-plugin-install-doc';
import type { LoomPlugin } from '@u1in/loom-core';

const gitCheck: LoomPlugin = {
  name: 'demo-git-check',
  apply: (api) => {
    api.addTransform((tree) => {
      tree.children.push(
        { type: 'heading', depth: 2, children: [{ type: 'text', value: '使用前检查' }] },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '请确认已安装 Git 2.30 或更新版本。' }],
        },
      );
      return tree;
    });
  },
};

export default defineConfig({
  skills: [
    { name: 'pr-review', source: 'src/skills/pr-review' },
    { name: 'release-notes', source: 'src/skills/release-notes' },
  ],
  commonNotice: { file: 'src/partials/notice.md' },
  variables: { PROJECT_NAME: 'Loom Demo' },
  injections: {
    text: [{ id: 'footer', position: 'bottom', content: 'Built for {{PROJECT_NAME}}.' }],
    metadata: [{ path: 'category', value: 'demo' }],
  },
  plugins: [gitCheck, installDoc()],
  replacements: [{ search: 'EXAMPLE_PROJECT', replace: 'Loom Demo' }],
});
