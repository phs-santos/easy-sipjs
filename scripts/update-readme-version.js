import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.join(__dirname, '../package.json');
const readmePath = path.join(__dirname, '../README.md');

try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;
    let readmeContent = fs.readFileSync(readmePath, 'utf8');

    // Regex to match # easy-sipjs (v1.2.0)
    const versionRegex = /(# easy-sipjs \(v)([\d\.]+)(\))/;

    if (versionRegex.test(readmeContent)) {
        const updatedReadme = readmeContent.replace(versionRegex, `$1${version}$3`);

        if (readmeContent !== updatedReadme) {
            fs.writeFileSync(readmePath, updatedReadme, 'utf8');
            console.log(`✅ README.md atualizado para a versão v${version}`);
        } else {
            console.log(`ℹ️ README.md já está na versão v${version}`);
        }
    } else {
        console.error('❌ Não foi possível encontrar a tag de versão no README.md (ex: # easy-sipjs (v1.2.0))');
    }
} catch (error) {
    console.error('❌ Erro ao atualizar o README.md:', error.message);
    process.exit(1);
}
