import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = process.cwd();
const systemDir = path.join(rootDir, '_system');
const systemDist = path.join(systemDir, 'dist');
const rootDist = path.join(rootDir, 'dist');

console.log('[Build] Building _system assets...');
execSync('npm run build', { cwd: systemDir, stdio: 'inherit' });

console.log('[Build] Mirroring dist to root for cloud deployment...');
fs.cpSync(systemDist, rootDist, { recursive: true });
console.log('[Build] Root dist ready with', fs.readdirSync(rootDist).length, 'entries.');
