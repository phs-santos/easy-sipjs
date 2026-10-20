#!/usr/bin/env node
// Release interativo: commita o que estiver pendente, sobe a versão, cria a tag, faz o push
// e publica no npm a partir desta máquina (precisa de `npm login`; o npm pode pedir o código 2FA).
//
// Uso: npm run release            (executa)
//      npm run release -- --dry-run  (só mostra o que faria)

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const rl = readline.createInterface({ input: stdin, output: stdout });
rl.on('SIGINT', () => abort('Cancelado.'));

const c = {
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function abort(msg) {
    console.error(`\n${c.red('✖')} ${msg}`);
    rl.close();
    process.exit(1);
}

// Lê algo do git/npm, sem efeito colateral.
function read(cmd) {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Executa um comando que altera algo. No dry-run só imprime.
function run(cmd, args, { always = false } = {}) {
    console.log(c.dim(`$ ${cmd} ${args.join(' ')}`));
    if (dryRun && !always) return;
    const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
    if (res.status !== 0) abort(`Falhou: ${cmd} ${args.join(' ')}`);
}

async function ask(question, def = '') {
    const hint = def ? c.dim(` (${def})`) : '';
    const answer = (await rl.question(`${c.cyan('?')} ${question}${hint} `)).trim();
    return answer || def;
}

async function confirm(question, def = true) {
    const answer = (await ask(`${question} ${def ? '[S/n]' : '[s/N]'}`)).toLowerCase();
    if (!answer) return def;
    return answer.startsWith('s') || answer.startsWith('y');
}

async function choose(question, options) {
    console.log(`${c.cyan('?')} ${question}`);
    options.forEach((o, i) => console.log(`  ${c.bold(i + 1)}) ${o.label}`));
    while (true) {
        const n = Number(await ask('Escolha', '1'));
        if (n >= 1 && n <= options.length) return options[n - 1];
        console.log(c.yellow(`  Digite um número de 1 a ${options.length}.`));
    }
}

// --- versão -----------------------------------------------------------------

function parse(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(v);
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

// Mesmas regras do `npm version`.
function bump(v, type) {
    const s = parse(v);
    const base = `${s.major}.${s.minor}.${s.patch}`;
    switch (type) {
        case 'patch':
            return s.pre ? base : `${s.major}.${s.minor}.${s.patch + 1}`;
        case 'minor':
            return s.pre && s.patch === 0 ? base : `${s.major}.${s.minor + 1}.0`;
        case 'major':
            return s.pre && s.minor === 0 && s.patch === 0 ? base : `${s.major + 1}.0.0`;
        case 'beta': {
            const m = /^beta\.(\d+)$/.exec(s.pre ?? '');
            if (m) return `${base}-beta.${+m[1] + 1}`;
            if (s.pre) return `${base}-beta.0`;
            return `${s.major}.${s.minor}.${s.patch + 1}-beta.0`;
        }
    }
}

// --- passos -----------------------------------------------------------------

async function main() {
    const pkgPath = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(`\n${c.bold(pkg.name)} ${c.dim(`v${pkg.version}`)}${dryRun ? c.yellow('  [dry-run: nada será alterado]') : ''}\n`);

    // 0. Login no npm (a publicação sai daqui, não do CI)
    let npmUser;
    try {
        npmUser = read('npm whoami');
    } catch {
        abort('Você não está logado no npm. Rode "npm login" e tente de novo.');
    }

    // 1. Branch e sincronia com o remoto
    const branch = read('git rev-parse --abbrev-ref HEAD');
    if (branch === 'HEAD') abort('Você está fora de uma branch (HEAD solto). Faça checkout da main primeiro.');
    if (branch !== 'main' && !(await confirm(c.yellow(`Você está na branch "${branch}", não na main. Continuar?`), false))) {
        abort('Cancelado.');
    }
    console.log(c.dim('Buscando o remoto...'));
    read('git fetch origin --tags --quiet');
    const behind = Number(read(`git rev-list --count HEAD..origin/${branch} 2>/dev/null || echo 0`));
    if (behind > 0) abort(`A branch está ${behind} commit(s) atrás de origin/${branch}. Rode git pull antes.`);

    // 2. Alterações pendentes
    const pending = read('git status --porcelain');
    let commitMsg = null;
    if (pending) {
        console.log(`\n${c.bold('Alterações pendentes:')}`);
        console.log(execSync('git status --short', { cwd: root, encoding: 'utf8' }).trimEnd().split('\n').map((l) => `  ${l}`).join('\n'));
        console.log();
        if (!(await confirm('Commitar tudo isso junto com o release?'))) {
            abort('Commite ou guarde (git stash) as alterações e rode de novo.');
        }
        while (!commitMsg) {
            commitMsg = await ask('Mensagem do commit (ex: feat: adiciona X / fix: corrige Y):');
        }
    }

    // 3. Versão nova
    const types = ['patch', 'minor', 'major', 'beta'];
    const descriptions = {
        patch: 'correção, sem mudar a API',
        minor: 'recurso novo, compatível',
        major: 'quebra compatibilidade',
        beta: 'pré-release (instala com @beta)',
    };
    const picked = await choose('\nQue tipo de versão?', [
        ...types.map((t) => ({ type: t, label: `${t.padEnd(6)} ${c.green(bump(pkg.version, t))}  ${c.dim(descriptions[t])}` })),
        { type: 'custom', label: 'outra (digitar)' },
    ]);
    let version = picked.type === 'custom' ? await ask('Versão:') : bump(pkg.version, picked.type);
    version = version.replace(/^v/, '');
    if (!parse(version)) abort(`Versão inválida: ${version}`);
    const tag = `v${version}`;
    const isPre = parse(version).pre !== null;

    if (read(`git tag -l ${tag}`)) abort(`A tag ${tag} já existe.`);
    try {
        read(`npm view ${pkg.name}@${version} version`);
        abort(`A versão ${version} já está publicada no npm.`);
    } catch {
        // não publicada: ok
    }

    // 4. CHANGELOG
    const changelogPath = path.join(root, 'CHANGELOG.md');
    let changelog = fs.readFileSync(changelogPath, 'utf8');
    const today = new Date().toISOString().slice(0, 10);
    const unreleased = /^## \[Unreleased\].*$/im;
    let changelogNote;
    if (changelog.includes(`## [${version}]`)) {
        changelogNote = `já tem a seção [${version}]`;
    } else if (unreleased.test(changelog)) {
        changelog = changelog.replace(unreleased, `## [${version}] - ${today}`);
        changelogNote = `[Unreleased] vira [${version}] - ${today}`;
    } else {
        console.log(c.yellow(`\n⚠ O CHANGELOG.md não tem seção "## [Unreleased]" nem "## [${version}]".`));
        if (!(await confirm('Continuar sem atualizar o CHANGELOG?', false))) {
            abort('Adicione as notas em "## [Unreleased]" no CHANGELOG.md e rode de novo.');
        }
        changelog = null;
        changelogNote = c.yellow('sem alteração');
    }

    // 5. GitHub Release
    const ghReady = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0;
    const makeGhRelease = ghReady && (await confirm('Criar o GitHub Release com o bundle (easy-sip.min.js)?'));

    // 6. Resumo
    console.log(`\n${c.bold('Resumo')}`);
    console.log(`  versão      ${pkg.version} → ${c.green(version)}${isPre ? c.dim('  (npm tag: beta)') : ''}`);
    if (commitMsg) console.log(`  commit      ${commitMsg}`);
    console.log(`  release     chore(release): ${version} + tag ${tag}`);
    console.log(`  changelog   ${changelogNote}`);
    console.log(`  push        origin ${branch} + ${tag}`);
    console.log(`  npm         publica como ${npmUser}${isPre ? ' (tag beta)' : ''}`);
    console.log(`  gh release  ${makeGhRelease ? 'sim' : 'não'}`);
    console.log();
    if (!(await confirm('Confirmar?'))) abort('Cancelado.');

    // 7. Checagens antes de mexer no git (lint, testes, build)
    console.log(`\n${c.bold('Checando...')}`);
    run('npm', ['run', 'lint'], { always: true });
    run('npm', ['test'], { always: true });
    run('npm', ['run', 'build'], { always: true });

    // 8. Commit das alterações pendentes
    console.log(`\n${c.bold('Commitando...')}`);
    if (commitMsg) {
        run('git', ['add', '-A']);
        run('git', ['commit', '-m', commitMsg]);
    }

    // 9. Versão, changelog, commit de release e tag
    run('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts']);
    if (changelog && !dryRun) fs.writeFileSync(changelogPath, changelog);
    run('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
    run('git', ['commit', '-m', `chore(release): ${version}`]);
    run('git', ['tag', '-a', tag, '-m', tag]);

    // 10. Push
    console.log(`\n${c.bold('Enviando...')}`);
    run('git', ['push', '--atomic', 'origin', branch, tag]);

    // 11. Publicação no npm. Lint, testes e build já rodaram no passo 7, então
    // --ignore-scripts evita repetir o prepublishOnly.
    console.log(`\n${c.bold('Publicando no npm...')}`);
    const publishArgs = ['publish', '--access', 'public', '--ignore-scripts', ...(isPre ? ['--tag', 'beta'] : [])];
    console.log(c.dim(`$ npm ${publishArgs.join(' ')}`));
    if (!dryRun) {
        const res = spawnSync('npm', publishArgs, { cwd: root, stdio: 'inherit' });
        if (res.status !== 0) {
            abort(`A tag ${tag} já foi enviada, mas a publicação no npm falhou.\n  Para tentar de novo: npm ${publishArgs.join(' ')}`);
        }
    }

    if (makeGhRelease) {
        const args = ['release', 'create', tag, 'dist/easy-sip.min.js', 'dist/easy-sip.min.js.map', '--generate-notes'];
        if (isPre) args.push('--prerelease');
        run('gh', args);
    }

    const repo = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
    console.log(`\n${c.green('✔')} ${tag} publicado${dryRun ? ' (dry-run)' : ''}.`);
    console.log(`  GitHub: ${repo}/tree/${tag}`);
    console.log(`  npm:    https://www.npmjs.com/package/${pkg.name}\n`);
    rl.close();
}

main().catch((err) => abort(err.message));
