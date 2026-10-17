import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const report = JSON.parse(readFileSync(`${root}/evidence/verification.json`, 'utf8'));
if (!report.passed) throw new Error('Run npm run verify successfully before packaging.');
const hash = createHash('sha256');
function hashSources(relative) {
  for (const name of readdirSync(`${root}/${relative}`).sort()) {
    const path = `${relative}/${name}`;
    if (statSync(`${root}/${path}`).isDirectory()) hashSources(path);
    else hash.update(path + '\0').update(readFileSync(`${root}/${path}`));
  }
}
for (const path of ['src', 'test', 'scripts', 'web']) hashSources(path);
if (report.source_sha256 !== hash.digest('hex')) throw new Error('Source changed since verification; rerun npm run verify.');
if (report.lockfile_sha256 !== createHash('sha256').update(readFileSync(`${root}/package-lock.json`)).digest('hex'))
  throw new Error('Lockfile changed since verification.');
const entries = ['README.md','LICENSE','package.json','package-lock.json','tsconfig.json','Dockerfile','.gitignore','.dockerignore','.env.example',
  '.github/workflows/ci.yml','src','test','scripts','docs','examples','experiments','evidence','dist','web'];
for (const path of entries) if (!existsSync(`${root}/${path}`)) throw new Error(`Missing package input ${path}`);
const out = resolve(process.argv[2] ?? `${root}/../RetryProof-UI-Connected.zip`);
const python = String.raw`
import hashlib,json,pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2]); entries=json.loads(sys.argv[3])
files=[]
for item in entries:
 p=root/item
 files.extend([x for x in p.rglob('*') if x.is_file()] if p.is_dir() else [p])
files=sorted(set(files),key=lambda p:p.relative_to(root).as_posix())
manifest=[]
output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:
  relative=p.relative_to(root).as_posix()
  if p.is_symlink() or p.suffix in ['.sqlite','.log'] or 'node_modules' in p.parts or (p.name.startswith('.env') and p.name!='.env.example'):
   raise RuntimeError('Forbidden package entry: '+relative)
  payload=p.read_bytes(); manifest.append(hashlib.sha256(payload).hexdigest()+'  '+relative)
  z.writestr('retryproof/'+relative,payload)
 z.writestr('retryproof/MANIFEST.sha256','\n'.join(manifest)+'\n')
with zipfile.ZipFile(output) as z:
 assert z.testzip() is None
print(json.dumps({'zip':str(output),'files':len(files)+1,'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
`;
let result = spawnSync('python3', ['-c', python, root, out, JSON.stringify(entries)], { encoding: 'utf8' });
if (result.error?.code === 'ENOENT') result = spawnSync('python', ['-c', python, root, out, JSON.stringify(entries)], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Packaging failed');
console.log(result.stdout.trim());
