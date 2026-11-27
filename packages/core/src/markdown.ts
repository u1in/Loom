import { unified } from 'unified';
import parse from 'remark-parse';
import frontmatter from 'remark-frontmatter';
import stringify from 'remark-stringify';
import { parse as parseYaml } from 'yaml';

export const processor = unified()
  .use(parse)
  .use(frontmatter)
  .use(stringify, { bullet: '-', emphasis: '*', fences: true });

export const parseSkillDocument = (source: string, label: string) => {
  const tree = processor.parse(source);
  const first = tree.children[0];
  if (first?.type !== 'yaml') throw new Error(label + ': missing YAML frontmatter');
  return { tree, frontmatter: parseYaml(first.value) as unknown };
};
