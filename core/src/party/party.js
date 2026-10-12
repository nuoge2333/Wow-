/**
 * Easter Egg Party Manager
 * Hidden module for wow
 * Keep it mysterious.
 *
 * Usage: wow install party
 *
 * To add a new easter egg:
 *   1. Add an entry to EGG_REGISTRY below
 *   2. Upload its zip archive somewhere accessible
 *   3. Done. No other file needs to change.
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const readline = require('readline');

// ==================== EASTER EGG REGISTRY ====================
// Add new easter eggs here. Each entry describes:
//   - name:        display name
//   - description: short hint shown in the menu
//   - url:         download URL for the ZIP archive
//   - entry:       the JS file to run after extraction
//   - passwords:   array of passwords to verify, in order
//   - hint:        hint text for each password (optional)

const EGG_REGISTRY = {
    badapple: {
        name: 'Bad Apple',
        description: 'Bad Apple',
        url: 'https://gitee.com/nuoge233/wowegg/raw/main/badapple.zip',
        entry: 'badapple.js',
        passwords: [
            { value: 'bad_apple', hint: '' },
            { value: 'Reimu_Marisa_Rumia_Patchouli_Remilia_Sakuya_Flandre_Youmu_Yuyuko_Komachi_Eiki_Mokou_Keine_Eirin_Kaguya_Lunasa_Merlin_Lyrica_Chen_Ran_Tewi_Reisen_Momiji_Sanae_Hina_Kanako_Suwako_Yukari_Tenshi_Aya_Suika_Alice_Nitori_Yuuka_Elly', hint: 'All characters in Bad Apple PV, joined by underscores' }
        ]
    }
    // Example for future additions:
    // rickroll: {
    //     name: 'Never Gonna Give You Up',
    //     description: 'Rickroll in terminal',
    //     url: 'https://example.com/rickroll.zip',
    //     entry: 'rickroll.js',
    //     passwords: [
    //         { value: 'never_gonna_give_you_up', hint: 'A famous 1987 song' }
    //     ]
    // }
};

// ==================== PATHS ====================
// core/src/party/party.js -> core/party
const PARTY_DIR = path.join(__dirname, '../../party');

// ==================== HELPERS ====================
function ask(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadFile(url, dest) {
    const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 120000
    });
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// ==================== EGG HANDLING ====================
async function ensureEgg(eggId) {
    const egg = EGG_REGISTRY[eggId];
    if (!egg) throw new Error(`Unknown egg: ${eggId}`);

    const eggDir = path.join(PARTY_DIR, eggId);
    const entryPath = path.join(eggDir, egg.entry);
    const zipPath = path.join(PARTY_DIR, `${eggId}.zip`);

    // Already cached?
    if (fs.existsSync(entryPath)) {
        console.log('✅ Easter egg already cached.');
        return { eggDir, entryPath };
    }

    // Download + extract
    console.log('📦 Downloading easter egg archive...');
    fs.ensureDirSync(PARTY_DIR);
    fs.ensureDirSync(eggDir);

    try {
        await downloadFile(egg.url, zipPath);
        console.log('✅ Download complete. Extracting...');

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(eggDir, true);

        // Clean up the zip file
        fs.removeSync(zipPath);

        if (!fs.existsSync(entryPath)) {
            throw new Error(`Entry file not found after extraction: ${egg.entry}`);
        }

        console.log('✅ Extraction complete.');
        return { eggDir, entryPath };
    } catch (e) {
        console.error('❌ Download or extraction failed:', e.message);
        // Clean up partial downloads
        if (fs.existsSync(zipPath)) fs.removeSync(zipPath);
        throw e;
    }
}

async function verifyPasswords(egg) {
    for (let i = 0; i < egg.passwords.length; i++) {
        const pwd = egg.passwords[i];
        console.log('');
        console.log(`🔑 Password ${i + 1} of ${egg.passwords.length}:`);
        if (pwd.hint) console.log(`   Hint: ${pwd.hint}`);

        const answer = await ask('> ');
        if (answer !== pwd.value) {
            console.log('❌ Wrong password. This never happened.');
            return false;
        }
        console.log('✅ Accepted.');
    }
    return true;
}

function playEgg(entryPath, eggDir) {
    console.log('');
    console.log('🎬 Playing...');
    console.log('');

    const child = spawn('node', [entryPath], {
        stdio: 'inherit',
        cwd: eggDir
    });

    return new Promise((resolve) => {
        child.on('close', (code) => {
            console.log(`\n✨ Easter egg finished (exit code ${code})`);
            resolve();
        });
    });
}

// ==================== MAIN ENTRY ====================
async function runParty() {
    console.clear();
    console.log('🎉 You found a hidden easter egg!');
    console.log('');

    const eggIds = Object.keys(EGG_REGISTRY);
    if (eggIds.length === 0) {
        console.log('No easter eggs available.');
        return;
    }

    // If only one egg, skip the menu
    let eggId;
    if (eggIds.length === 1) {
        eggId = eggIds[0];
        console.log(`Egg: ${EGG_REGISTRY[eggId].name}`);
    } else {
        console.log('Available eggs:');
        eggIds.forEach((id, i) => {
            const egg = EGG_REGISTRY[id];
            console.log(`  ${i + 1}. ${id} — ${egg.description}`);
        });
        console.log('');
        const choice = await ask('Enter egg name: ');
        eggId = choice.trim().toLowerCase();
    }

    const egg = EGG_REGISTRY[eggId];
    if (!egg) {
        console.log(`❌ Unknown egg: ${eggId}`);
        return;
    }

    // Verify passwords
    const ok = await verifyPasswords(egg);
    if (!ok) return;

    // Ensure egg files are present
    let entryPath, eggDir;
    try {
        const result = await ensureEgg(eggId);
        entryPath = result.entryPath;
        eggDir = result.eggDir;
    } catch (e) {
        return;
    }

    // Give a short pause before the show
    await sleep(800);

    // Play
    await playEgg(entryPath, eggDir);
}

// Direct execution: node party.js
if (require.main === module) {
    runParty().catch((e) => console.error(e));
}

module.exports = { runParty, EGG_REGISTRY };
