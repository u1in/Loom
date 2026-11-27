export const deriveSource = (baseUrl?: string): string | undefined => {
  if (!baseUrl || !URL.canParse(baseUrl)) return undefined;
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const pathname = url.pathname.replace(/\/+$/, '');
  const gitlab = /^\/(.+?)\/-\/raw\/(.+)$/.exec(pathname);
  if (gitlab) return url.origin + '/' + gitlab[1] + '/-/tree/' + gitlab[2];

  if (url.hostname === 'raw.githubusercontent.com') {
    const github = /^\/([^/]+\/[^/]+)\/(?:refs\/(?:heads|tags)\/)?(.+)$/.exec(pathname);
    if (github) return 'https://github.com/' + github[1] + '/tree/' + github[2];
  }
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const github = /^\/([^/]+\/[^/]+)\/(?:raw|blob)\/(.+)$/.exec(pathname);
    if (github) return 'https://github.com/' + github[1] + '/tree/' + github[2];
  }
  return undefined;
};

export interface InstallDocInput {
  name: string;
  version: string;
  description?: string;
  source?: string;
  template?: string;
  variables?: Record<string, string>;
  warn?: (message: string) => void;
}

const normalize = (value: string) => value.replace(/\r\n?/g, '\n');

const interpolate = (text: string, vars: Record<string, string>, warn?: (m: string) => void) =>
  text.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (match, key: string) => {
    const value = Object.hasOwn(vars, key) ? vars[key] : undefined;
    if (value !== undefined) return value;
    warn?.('install doc: unknown variable ' + key);
    return match;
  });

export const renderInstallDoc = (input: InstallDocInput): string => {
  const defaultText = input.source
    ? '请使用 `skills` CLI，从 [{{source}}]({{source}}) 将 `{{name}}` 安装到当前 harness。'
    : '请从本目录将 `{{name}}` 安装到当前 harness。';
  const template = input.template ?? defaultText;
  const vars: Record<string, string> = {
    ...input.variables,
    name: input.name,
    skill: input.name,
    version: input.version,
    description: input.description ?? '',
    source: input.source ?? '',
  };
  const output = interpolate(normalize(template), vars, input.warn);
  return output.endsWith('\n') ? output : output + '\n';
};
