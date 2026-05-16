import { readFileSync, copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

let vaultPath;
for (const configPath of [join(process.env.HOME, '.obsidian-dev.json'), 'deploy.config.json']) {
    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        if (config.vaultPath) {
            vaultPath = config.vaultPath;
            break;
        }
    } catch (e) {}
}
if (!vaultPath) {
    console.error('Error: No vaultPath found. Set it in ~/.obsidian-dev.json or deploy.config.json');
    console.error('Example: { "vaultPath": "/path/to/your/vault" }');
    process.exit(1);
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pluginDir = join(vaultPath, '.obsidian', 'plugins', manifest.id);

mkdirSync(pluginDir, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    copyFileSync(file, join(pluginDir, file));
    console.log(`Copied ${file} → ${pluginDir}/`);
}
