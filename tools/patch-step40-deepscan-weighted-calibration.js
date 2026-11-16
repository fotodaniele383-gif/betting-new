const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(process.argv[2] || process.cwd());
const patchRoot = path.resolve(__dirname, '..');

function copyFile(rel) {
    const src = path.join(patchRoot, rel);
    const dst = path.join(projectRoot, rel);
    if (!fs.existsSync(src)) {
        throw new Error(`File patch mancante: ${src}`);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backup = `${dst}.bak-step40-${stamp}`;
        fs.copyFileSync(dst, backup);
        console.log(`Backup creato: ${backup}`);
    }
    fs.copyFileSync(src, dst);
    console.log(`Aggiornato: ${dst}`);
}

try {
    const packageJson = path.join(projectRoot, 'package.json');
    const backendDir = path.join(projectRoot, 'backend');
    if (!fs.existsSync(packageJson) || !fs.existsSync(backendDir)) {
        console.error(`\n❌ Cartella progetto non valida: ${projectRoot}`);
        console.error('Esegui dalla root BettingApp oppure passa il percorso della root come argomento.');
        process.exit(1);
    }

    copyFile(path.join('backend', 'deepScanTennis.js'));
    copyFile(path.join('backend', 'tests', 'tennisDeepScanWeightedCalibration.test.js'));

    console.log('\n✅ STEP 40 applicato. DeepScan Tennis ora usa il layer Weighted Calibration v15.0.');
    console.log('\nTest consigliato:');
    console.log('npx.cmd jest backend/tests/tennisDeepScanWeightedCalibration.test.js backend/tests/tennisDeepScanContextGateAudit.test.js backend/tests/tennisKellyStakePolicy.test.js backend/tests/app.paperPerformanceBreakdown.ui.test.js backend/tests/ui.graphics.v14_7.test.js backend/tests/ui.background.bankroll.test.js --runInBand');
} catch (error) {
    console.error(`\n❌ Errore patch STEP 40: ${error.message}`);
    process.exit(1);
}
