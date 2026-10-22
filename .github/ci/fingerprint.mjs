// Pure projections: never import or execute product code.
import { createRequire as makeRequire } from 'node:module';
const candidates=['.','frontend','app','apps/web','apps/api'];
function dependency(name) {
 for(const dir of candidates) {
  const require=makeRequire(process.cwd()+'/'+dir+'/package.json');
  try{return require(name)}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error}
  if(name.startsWith('@vue/'))try{return makeRequire(require.resolve('vue/package.json'))(name)}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error}
 }
 throw Error('Required compiler dependency unavailable: '+name)
}
let ts;
const typescript=()=>{ if(ts)return ts; try { const t=dependency('ci-typescript'); if(t.createSourceFile)return ts=t; }catch{} const t=dependency('typescript'); if(!t.createSourceFile)throw Error('Locked compiler has no stable AST API; install ci-typescript alias'); return ts=t; };
import { createRequire } from 'node:module';
const parseSfc=(...args)=>dependency('@vue/compiler-sfc').parse(...args);
const baseParse=(...args)=>dependency('@vue/compiler-dom').baseParse(...args);
const NodeTypes={ROOT:0,ELEMENT:1,TEXT:2,COMMENT:3,INTERPOLATION:5,ATTRIBUTE:6};
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value;
const hash = value => createHash('sha256').update(value).digest('hex');
export function scriptProjection(source, filename = 'input.ts') {
  const ts=typescript();
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse critical script: ${filename}`);
  return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(file);
}
export function vueProjection(source, filename = 'input.vue') {
  const { descriptor, errors } = parseSfc(source, { filename });
  if (errors.length || descriptor.script?.src || descriptor.scriptSetup?.src || descriptor.template?.src || descriptor.template?.lang) {
    throw new Error(`Unsupported critical SFC: ${filename}`);
  }
  const script = [descriptor.script, descriptor.scriptSetup].filter(Boolean).map(s => scriptProjection(s.content, filename + '.ts'));
  const tree = descriptor.template ? baseParse(descriptor.template.content) : null;
  const visit = node => {
    if (node.type === NodeTypes.COMMENT || node.type === NodeTypes.TEXT) return null;
    if (node.type === NodeTypes.ROOT) return node.children.map(visit).filter(Boolean);
    if (node.type === NodeTypes.ELEMENT) return {
      type: node.type, tag: node.tag, tagType: node.tagType,
      // Only presentation attributes are excluded. Values, names, URLs, input types,
      // event handlers, v-model, conditions and ALL other directives remain.
      props: node.props.filter(p => !(p.type === NodeTypes.ATTRIBUTE && ['class', 'style', 'title', 'aria-label', 'placeholder'].includes(p.name)))
        .map(p => p.type === NodeTypes.ATTRIBUTE ? [p.name, p.value?.content ?? null]
          : [p.name, p.arg?.content, p.exp?.content, p.modifiers.map(m => m.content ?? m)]),
      children: node.children.map(visit).filter(Boolean),
    };
    if (node.type === NodeTypes.INTERPOLATION) return ['expression', node.content.content];
    throw new Error(`Unsupported critical template node ${node.type}: ${filename}`);
  };
  return JSON.stringify({ script, template: tree ? visit(tree) : null, cssVars: descriptor.cssVars });
}
// Resolve only package-lock entries used by a group, including transitive/peer/optional
// dependencies. An unresolved dependency is a planning error, never a cache hit.
export function dependencyProjection(lock, roots) {
  if (!lock.packages || lock.lockfileVersion < 2) throw new Error('Expected npm package-lock v2/v3');
  const visited = new Set();
  function resolve(name, parent = '') {
    let prefix = parent;
    for (;;) {
      const key = (prefix ? prefix + '/' : '') + 'node_modules/' + name;
      if (lock.packages[key]) return key;
      if (!prefix) break;
      const cut = prefix.lastIndexOf('/node_modules/');
      prefix = cut < 0 ? '' : prefix.slice(0, cut);
    }
    throw new Error(`Missing locked dependency ${name}`);
  }
  function add(name, parent = '', optional = false) {
    let key;
    try { key = resolve(name, parent); } catch (error) { if (optional) return; throw error; }
    if (visited.has(key)) return;
    visited.add(key);
    const pkg = lock.packages[key];
    if (pkg.link) { const linked=lock.packages[pkg.resolved]; if(!linked)throw Error('Missing workspace '+key); for(const dep of Object.keys(linked.dependencies??{}))add(dep); return; }
    for (const dep of Object.keys(pkg.dependencies ?? {})) add(dep, key);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) add(dep, key, true);
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) add(dep, key, Boolean(pkg.peerDependenciesMeta?.[dep]?.optional));
  }
  for (const name of roots) add(name);
  return [...visited].sort().map(key => [key, structuredClone(lock.packages[key])]);
}
export function hasUnclassifiedWrite(source, filename) {
  let code = source;
  if (filename.endsWith('.vue')) {
    const parsed = parseSfc(source, { filename });
    if (parsed.errors.length) throw new Error(`Cannot classify changed SFC: ${filename}`);
    code = [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean).map(s => s.content).join('\n');
  }
  const ts=typescript();
  const file = ts.createSourceFile(filename + '.ts', code, ts.ScriptTarget.Latest, true);
  let unsafe = false;
  const walk = node => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(file);
      if ((['fetch','campusApiRequest'].includes(name) || /\.(post|put|patch|delete)$/.test(name))) {
        const options = node.arguments[1];
        if (options && (!ts.isObjectLiteralExpression(options) || options.properties.some(p =>
          !ts.isPropertyAssignment(p) || (p.name.getText(file) === 'method' && !['GET', 'HEAD'].includes(p.initializer.text)) || p.name.getText(file) === 'body'))) unsafe = true;
      }
      if (/\.(save|persist|delete|remove|create|update|publish|claim|reconcile|submit|checkout|pay|refund|purchase|clear)[A-Z_a-z0-9]*$/.test(name)) unsafe = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return unsafe;
}
export function reactProjection(source,filename='input.tsx') {
  const ts=typescript();const file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  if(file.parseDiagnostics.length)throw Error('Cannot parse critical TSX: '+filename);
  const result=ts.transform(file,[context=>{const visit=node=>{
    if(ts.isJsxText(node)) return undefined;
    if(ts.isJsxAttribute(node)&&['className','style','title','aria-label','placeholder'].includes(node.name.text))return undefined;
    return ts.visitEachChild(node,visit,context);
  };return node=>ts.visitNode(node,visit)}]);
  try{return ts.createPrinter({removeComments:true}).printFile(result.transformed[0])}finally{result.dispose()}
}
export function project(path, text, mode = 'bytes') {
  if (mode === 'package-critical') {
    const p=JSON.parse(text);
    return hash(JSON.stringify(stable(Object.fromEntries(Object.entries(p).filter(([key])=>!['description','keywords','author','contributors','funding','homepage','bugs'].includes(key))))));
  }
  if (mode === 'vue-critical') return hash(vueProjection(text, path));
  if (mode === 'tsx-critical') return hash(reactProjection(text,path));
  if (mode === 'typescript') return hash(scriptProjection(text, path));
  return hash(text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input);
    if (request.operation === 'parse-jsonc') { const parsed=typescript().parseConfigFileTextToJson('bun.lock',request.text); if(parsed.error)throw Error('Malformed JSONC lock'); console.log(JSON.stringify(parsed.config)); }
    else if (request.operation === 'match-map') {
      const picomatch=createRequire(import.meta.url)('picomatch');
      console.log(JSON.stringify(Object.fromEntries(Object.entries(request.groups).map(([id,patterns])=>[id,request.paths.filter(p=>picomatch(patterns,{dot:true})(p))]))));
    }
    else if (request.operation === 'audit-writes') console.log(JSON.stringify(request.files.map(f => hasUnclassifiedWrite(f.text, f.path))));
    else if (request.operation === 'dependencies') console.log(JSON.stringify(dependencyProjection(request.lock, request.roots)));
    else console.log(JSON.stringify(request.files.map(f => project(f.path, f.text, f.projection))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
