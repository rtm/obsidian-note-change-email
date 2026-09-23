import { readFileSync, copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Prefer vaultPaths[process.platform] (platform-keyed); fall back to legacy string vaultPath.
// Both keys can coexist — old deploy scripts read vaultPath, new ones prefer vaultPaths.
function resolveVaultPath(config) {
    const map = config?.vaultPaths;
    if (map && typeof map === 'object') {
        const p = map[process.platform];
        if (typeof p === 'string') return p;
    }
    if (typeof config?.vaultPath === 'string') return config.vaultPath;
    return null;
}

// Read vault path: ~/.obsidian-dev.json (central) takes precedence, then deploy.config.json (per-repo)
let vaultPath;
for (const configPath of [join(homedir(), '.obsidian-dev.json'), 'deploy.config.json']) {
    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        const resolved = resolveVaultPath(config);
        if (resolved) {
            vaultPath = resolved;
            break;
        }
    } catch (e) {}
}
if (!vaultPath) {
    console.error(`Error: No vaultPath found for platform ${process.platform}.`);
    console.error('Set it in ~/.obsidian-dev.json (preferred) or deploy.config.json.');
    console.error('Example: { "vaultPath": { "win32": "C:\\\\path\\\\to\\\\Vault", "linux": "/mnt/c/path/to/Vault" } }');
    process.exit(1);
}

// Read plugin ID from manifest
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pluginDir = join(vaultPath, '.obsidian', 'plugins', manifest.id);

// Ensure plugin directory exists
mkdirSync(pluginDir, { recursive: true });

// Copy built files
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    copyFileSync(file, join(pluginDir, file));
    console.log(`Copied ${file} → ${pluginDir}/`);
}
