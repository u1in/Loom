import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import fg from 'fast-glob';
import picomatch from 'picomatch';
import { visit } from 'unist-util-visit';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  BuildContext,
  Content,
  EmitContext,
  LoadedConfig,
  LoomPlugin,
  MetadataTransform,
  PluginAPI,
  SkillContext,
  Transform,
  TransformContext,
} from './types';
import { validatePlugins } from './plugin';
import { DEFAULT_INSTALL_DOC, deriveSource, renderInstallDoc } from './install-doc';
import { parseSkillDocument, processor } from './markdown';

const normalize = (s: string) => s.replace(/\r\n?/g, '\n');
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const safePath = (p: string) => {
  if (!p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..') || /^[A-Za-z]:/.test(p))
    throw new Error('Invalid relative path: ' + p);
  const normalized = path.posix.normalize(p.replaceAll('\\\\', '/'));
  if (normalized === '.') throw new Error('Invalid relative path: ' + p);
  return normalized;
};
const readContent = async (content: Content, root: string) =>
  normalize(
    typeof content === 'string'
      ? content
      : await readFile(path.resolve(root, content.file), 'utf8'),
  );
const applies = (skills: string[] | undefined, name: string) => !skills || skills.includes(name);
const globMatch = (file: string, patterns?: string[]) =>
  !patterns || picomatch(patterns, { dot: true })(file);
const reserved = (fm: Record<string, unknown>) => {
  const metadata = obj(fm.metadata);
  return JSON.stringify([fm.name, metadata.version, obj(metadata.loom).commonNotice]);
};
const setNested = (o: Record<string, unknown>, key: string, value: unknown) => {
  const parts = key.split('.');
  let target = o;
  for (const part of parts.slice(0, -1)) {
    target[part] = obj(target[part]);
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = value;
};
type Entry<T> = { name: string; fn: T };
export interface BuildOptions {
  skill?: string;
  out?: string;
  check?: boolean;
  checkDeterminism?: boolean;
  reloadConfig?: () => Promise<LoadedConfig>;
  skipCache?: boolean;
}
export const build = async (config: LoadedConfig, options: BuildOptions = {}): Promise<void> => {
  if (options.checkDeterminism) {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'loom-'));
    try {
      await build(options.reloadConfig ? await options.reloadConfig() : config, {
        ...options,
        checkDeterminism: false,
        check: false,
        skipCache: true,
        out: path.join(temp, 'a'),
      });
      await build(options.reloadConfig ? await options.reloadConfig() : config, {
        ...options,
        checkDeterminism: false,
        check: false,
        skipCache: true,
        out: path.join(temp, 'b'),
      });
      const a = await hashFiles(path.join(temp, 'a')),
        b = await hashFiles(path.join(temp, 'b'));
      const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
        (k) => a[k] !== b[k],
      );
      if (diff.length) throw new Error('Non-deterministic output: ' + diff.join(', '));
      console.log('Determinism check passed');
      return;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  const output = path.resolve(config.rootDir, options.out ?? config.output);
  const plugins = validatePlugins(config.plugins ?? []);
  const logger = {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn('Warning: ' + m),
  };
  const ctx: BuildContext = {
    config,
    env: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: config.rootDir,
      loomVersion: '0.4.0',
    },
    variables: config.variables ?? {},
    logger,
    loomVersion: '0.4.0',
  };
  const before: Entry<Transform>[] = [],
    after: Entry<Transform>[] = [],
    metadataTransforms: Entry<MetadataTransform>[] = [];
  const emitHooks: Entry<(c: EmitContext) => void | Promise<void>>[] = [];
  const buildStart: Entry<(c: BuildContext) => void | Promise<void>>[] = [],
    buildEnd: typeof buildStart = [];
  const skillStart: Entry<(c: SkillContext) => void | Promise<void>>[] = [],
    skillEnd: typeof skillStart = [];
  const apiFor = (name: string): PluginAPI => ({
    ctx,
    addTransform: (fn, opts) => {
      (opts?.phase === 'after-replace' ? after : before).push({ name, fn });
    },
    addMetadataTransform: (fn) => {
      metadataTransforms.push({ name, fn });
    },
    onEmitFiles: (fn) => {
      emitHooks.push({ name, fn });
    },
    onBuildStart: (fn) => {
      buildStart.push({ name, fn });
    },
    onBuildEnd: (fn) => {
      buildEnd.push({ name, fn });
    },
    onSkillStart: (fn) => {
      skillStart.push({ name, fn });
    },
    onSkillEnd: (fn) => {
      skillEnd.push({ name, fn });
    },
  });
  const topPositions = new WeakMap<TransformContext, number>();
  const builtin: LoomPlugin = {
    name: 'loom:injections',
    apply: async (api) => {
      for (const item of config.injections?.text ?? []) {
        const content = await readContent(item.content, config.rootDir);
        api.addTransform((tree, c) => {
          if (!applies(item.skills, c.skillName)) return tree;
          const nodes = processor.parse(content).children;
          if (item.position === 'bottom') tree.children.push(...nodes);
          else {
            const index = topPositions.get(c) ?? 1;
            tree.children.splice(index, 0, ...nodes);
            topPositions.set(c, index + nodes.length);
          }
          return tree;
        });
      }
      for (const item of config.injections?.metadata ?? [])
        api.addMetadataTransform((fm, c) => {
          if (applies(item.skills, c.skillName)) {
            const m = obj(fm.metadata);
            const loom = obj(m.loom);
            const injections = obj(loom.injections);
            setNested(injections, item.path, item.value);
            loom.injections = injections;
            m.loom = loom;
            fm.metadata = m;
          }
          return fm;
        });
    },
  };
  const installDoc = config.installDoc ?? true;
  const installOptions = installDoc === true ? {} : installDoc;
  for (const plugin of [builtin, ...plugins])
    try {
      await plugin.apply(apiFor(plugin.name));
    } catch (e) {
      throw new Error('Plugin ' + plugin.name + ' apply: ' + String(e), { cause: e });
    }
  const runHooks = async <T>(
    entries: Entry<(x: T) => void | Promise<void>>[],
    arg: T,
    label: string,
  ) => {
    for (const e of entries)
      try {
        await e.fn(arg);
      } catch (err) {
        throw new Error('Plugin ' + e.name + ' ' + label + ': ' + String(err), { cause: err });
      }
  };
  await runHooks(buildStart, ctx, 'onBuildStart');
  const skills = options.skill
    ? config.skills.filter((s) => s.name === options.skill)
    : config.skills;
  if (!skills.length) throw new Error('Unknown skill: ' + options.skill);
  for (const skill of skills) {
    const source = path.resolve(config.rootDir, skill.source),
      target = path.join(output, 'skills', skill.name);
    const entry = skill.entry ?? 'SKILL.md';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(entry))
      throw new Error(skill.name + ': invalid source entry: ' + entry);
    const sourceRelative = path.relative(source, target);
    const targetRelative = path.relative(target, source);
    if (
      !options.check &&
      (!sourceRelative ||
        (!sourceRelative.startsWith('..' + path.sep) &&
          sourceRelative !== '..' &&
          !path.isAbsolute(sourceRelative)) ||
        !targetRelative ||
        (!targetRelative.startsWith('..' + path.sep) &&
          targetRelative !== '..' &&
          !path.isAbsolute(targetRelative)))
    ) {
      throw new Error(skill.name + ': source and output directories overlap');
    }
    const raw = normalize(await readFile(path.join(source, entry), 'utf8'));
    const document = parseSkillDocument(raw, skill.name);
    let tree = document.tree;
    let fm = obj(document.frontmatter);
    const version = obj(fm.metadata).version;
    if (fm.name !== skill.name)
      throw new Error(skill.name + ': frontmatter name does not match configuration');
    if (
      typeof version !== 'string' ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/.test(
        version,
      )
    )
      throw new Error(skill.name + ': invalid metadata.version');
    const vars = { ...config.variables, version, name: skill.name, skill: skill.name };
    const interpolate = (text: string) =>
      text.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (match, key: string) => {
        if (!(key in vars)) {
          logger.warn(skill.name + ': unknown variable ' + key);
          return match;
        }
        return vars[key as keyof typeof vars];
      });
    const tctx: TransformContext = {
      skillName: skill.name,
      version,
      variables: vars,
      config,
      logger,
      interpolate,
    };
    const readSource = async (p: string) => readFile(path.join(source, safePath(p)), 'utf8');
    const skillCtx: SkillContext = {
      skillName: skill.name,
      version,
      sourceDir: source,
      outputDir: target,
      get tree() {
        return tree;
      },
      get metadata() {
        return fm;
      },
      readSource,
    };
    await runHooks(skillStart, skillCtx, 'onSkillStart');
    let topPosition = 1;
    if (config.commonNotice && obj(obj(fm.metadata).loom).commonNotice !== false) {
      const notices = Array.isArray(config.commonNotice)
        ? config.commonNotice
        : [config.commonNotice];
      const firstHeadingIndex = tree.children.findIndex((node) => node.type === 'heading');
      const firstHeading = tree.children[firstHeadingIndex];
      if (notices.length && firstHeadingIndex !== -1) topPosition = firstHeadingIndex + 1;
      for (const item of notices) {
        const noticeTree = processor.parse(await readContent(item, config.rootDir));
        const headings: number[] = [];
        visit(noticeTree, 'heading', (node) => {
          headings.push(node.depth);
        });
        const automaticShift =
          firstHeading?.type === 'heading' && headings.length
            ? firstHeading.depth + 1 - Math.min(...headings)
            : 0;
        const shift =
          typeof item === 'string' ? automaticShift : (item.headingShift ?? automaticShift);
        visit(noticeTree, 'heading', (node) => {
          const depth = node.depth + shift;
          if (depth < 1 || depth > 6)
            throw new Error(skill.name + ': common notice heading exceeds valid levels 1–6');
          node.depth = depth as typeof node.depth;
        });
        tree.children.splice(topPosition, 0, ...noticeTree.children);
        topPosition += noticeTree.children.length;
      }
    }
    topPositions.set(tctx, topPosition);
    const transform = async (entries: Entry<Transform>[], phase: string) => {
      for (const entry of entries)
        try {
          tree = await entry.fn(tree, tctx);
        } catch (e) {
          throw new Error(
            'Plugin ' + entry.name + ' ' + skill.name + ' ' + phase + ': ' + String(e),
            { cause: e },
          );
        }
    };
    await transform(before, 'before-replace');
    const replace = (text: string, file: string) => {
      let result = interpolate(text);
      for (const rule of config.replacements ?? [])
        if (applies(rule.skills, skill.name) && globMatch(file, rule.files)) {
          const replacement = interpolate(rule.replace);
          result = rule.flags
            ? result.replace(new RegExp(rule.search, rule.flags), replacement)
            : result.split(rule.search).join(replacement);
        }
      return result;
    };
    visit(tree, (node) => {
      if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code')
        node.value = replace(node.value, 'SKILL.md');
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition')
        node.url = interpolate(node.url);
    });
    await transform(after, 'after-replace');
    for (const entry of metadataTransforms) {
      const old = reserved(fm);
      try {
        fm = await entry.fn(fm, tctx);
      } catch (e) {
        throw new Error('Plugin ' + entry.name + ' ' + skill.name + ' metadata: ' + String(e), {
          cause: e,
        });
      }
      if (reserved(fm) !== old)
        throw new Error('Plugin ' + entry.name + ' modified a reserved field');
    }
    const yamlNode = tree.children[0];
    if (yamlNode?.type !== 'yaml') throw new Error('Plugin removed frontmatter');
    yamlNode.value = stringifyYaml(fm, { lineWidth: 0, sortMapEntries: false }).trimEnd();
    const files = new Map<string, { data: Buffer; mode?: number }>();
    files.set('SKILL.md', { data: Buffer.from(String(processor.stringify(tree))) });
    const sourceFiles = (
      await fg('**/*', {
        cwd: source,
        onlyFiles: true,
        dot: true,
        followSymbolicLinks: false,
        ignore: config.exclude,
      })
    )
      .filter((file) => file !== entry && file !== 'SKILL.md')
      .sort();
    for (const file of sourceFiles) {
      const bytes = await readFile(path.join(source, file));
      const data = bytes.includes(0)
        ? bytes
        : Buffer.from(replace(normalize(bytes.toString('utf8')), file));
      files.set(file, { data, mode: (await stat(path.join(source, file))).mode });
    }
    const baseUrl = config.baseUrl && interpolate(config.baseUrl);
    if (installOptions && applies(installOptions.skills, skill.name)) {
      const file = safePath(installOptions.file ?? DEFAULT_INSTALL_DOC);
      if (file === entry || files.has(file)) {
        logger.warn(skill.name + ': ' + file + ' exists in source or output, install doc skipped');
      } else {
        const template = installOptions.template
          ? await readFile(path.resolve(config.rootDir, installOptions.template), 'utf8')
          : installOptions.text;
        const installSource = installOptions.source
          ? interpolate(installOptions.source)
          : deriveSource(baseUrl);
        if (!installSource && baseUrl)
          logger.warn(
            skill.name + ': install source is unknown, set installDoc.source to provide it',
          );
        const document = renderInstallDoc({
          name: skill.name,
          version,
          description: typeof fm.description === 'string' ? fm.description : undefined,
          source: installSource,
          template,
          variables: config.variables,
          warn: logger.warn,
        });
        files.set(file, { data: Buffer.from(document) });
      }
    }
    const emitCtx: EmitContext = {
      skillName: skill.name,
      version,
      readSource,
      build: ctx,
      emit: (p, data) => {
        files.set(safePath(p), { data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
      },
    };
    await runHooks(emitHooks, emitCtx, 'onEmitFiles');
    const emittedSkill = files.get('SKILL.md');
    const outputTree = emittedSkill && processor.parse(emittedSkill.data.toString('utf8'));
    const outputYaml = outputTree?.children[0];
    if (outputYaml?.type !== 'yaml') throw new Error(skill.name + ': output has no frontmatter');
    const outputFm = obj(parseYaml(outputYaml.value));
    if (reserved(outputFm) !== reserved(fm)) {
      throw new Error(skill.name + ': output changed reserved fields');
    }
    for (const [file, value] of files)
      if (file.endsWith('.md')) {
        const links = processor.parse(value.data.toString('utf8'));
        if (baseUrl) {
          const directoryUrl = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
          const documentUrl = new URL(
            file.split('/').map(encodeURIComponent).join('/'),
            directoryUrl,
          );
          let changed = false;
          visit(links, (node) => {
            if (
              (node.type === 'link' || node.type === 'image' || node.type === 'definition') &&
              node.url &&
              !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(node.url)
            ) {
              node.url = new URL(node.url, documentUrl).href;
              changed = true;
            }
          });
          if (changed) value.data = Buffer.from(String(processor.stringify(links)));
        }
        const pending: string[] = [];
        visit(links, (n) => {
          if (
            (n.type === 'link' || n.type === 'image') &&
            n.url &&
            !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(n.url)
          ) {
            const rel = decodeURIComponent(n.url.split(/[?#]/)[0] ?? '');
            if (rel)
              pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), rel)));
          }
        });
        for (const rel of pending)
          if (
            rel.startsWith('../') ||
            (!files.has(rel) && ![...files.keys()].some((f) => f.startsWith(rel + '/')))
          )
            throw new Error(skill.name + ': broken link ' + rel + ' in ' + file);
      }
    if (options.check) {
      const existing = await hashFiles(target);
      const expected = Object.fromEntries(
        [...files].map(([p, v]) => [p, createHash('sha256').update(v.data).digest('hex')]),
      );
      if (
        JSON.stringify(
          Object.keys(existing)
            .sort()
            .map((k) => [k, existing[k]]),
        ) !==
        JSON.stringify(
          Object.keys(expected)
            .sort()
            .map((k) => [k, expected[k]]),
        )
      )
        throw new Error(skill.name + ': output missing or out of date');
    } else {
      const sourceHash = JSON.stringify(await hashFileList(source, [entry, ...sourceFiles].sort()));
      const cacheFile = path.join(config.rootDir, '.loom-cache', skill.name + '.json');
      if (!options.skipCache) {
        try {
          const old = JSON.parse(await readFile(cacheFile, 'utf8')) as {
            version: string;
            hash: string;
          };
          if (old.version === version && old.hash !== sourceHash)
            logger.warn(skill.name + ': source changed but version unchanged (' + version + ')');
        } catch {
          // Missing or invalid cache is treated as a first build.
        }
      }
      const parent = path.dirname(target),
        tmp = path.join(parent, '.' + skill.name + '.tmp');
      await mkdir(parent, { recursive: true });
      await rm(tmp, { recursive: true, force: true });
      await mkdir(tmp, { recursive: true });
      try {
        for (const [file, value] of files) {
          const dest = path.join(tmp, safePath(file));
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, value.data);
          if (value.mode !== undefined) await chmod(dest, value.mode);
        }
        const backup = path.join(parent, '.' + skill.name + '.bak');
        let hasTarget = false;
        try {
          await access(backup);
          throw new Error('Backup already exists; resolve it before building: ' + backup);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        try {
          await rename(target, backup);
          hasTarget = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        try {
          await rename(tmp, target);
        } catch (error) {
          if (hasTarget) {
            try {
              await rename(backup, target);
            } catch (restoreError) {
              throw new AggregateError(
                [error, restoreError],
                'Could not restore previous output; backup remains at ' + backup,
              );
            }
          }
          throw error;
        }
        if (hasTarget) await rm(backup, { recursive: true, force: true });
      } catch (e) {
        await rm(tmp, { recursive: true, force: true });
        throw e;
      }
      if (!options.skipCache) {
        await mkdir(path.dirname(cacheFile), { recursive: true });
        await writeFile(cacheFile, JSON.stringify({ version, hash: sourceHash }) + '\n');
      }
      logger.info('✔ ' + skill.name + '@' + version + ' → ' + target);
    }
    await runHooks(skillEnd, skillCtx, 'onSkillEnd');
  }
  await runHooks(buildEnd, ctx, 'onBuildEnd');
};
const hashFileList = async (dir: string, files: string[]): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const file of files)
    result[file] = createHash('sha256')
      .update(await readFile(path.join(dir, file)))
      .digest('hex');
  return result;
};
export const hashFiles = async (dir: string): Promise<Record<string, string>> => {
  try {
    await access(dir);
  } catch {
    return {};
  }
  const files = await fg('**/*', { cwd: dir, onlyFiles: true, dot: true });
  return hashFileList(dir, files.sort());
};
