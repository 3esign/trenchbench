import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.txt');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node run_experimental_batch.mjs <arm> <num_runs>');
  console.log('Example: node run_experimental_batch.mjs s2a 10');
  process.exit(1);
}

const arm = args[0].toLowerCase();
const numRuns = parseInt(args[1], 10);

if (!['s2a', 's2b', 's2c', 's2d', 's2e'].includes(arm)) {
  console.log('Invalid arm. Must be one of: s2a, s2b, s2c, s2d, s2e');
  process.exit(1);
}

if (isNaN(numRuns) || numRuns <= 0) {
  console.log('num_runs must be a positive integer.');
  process.exit(1);
}

// Ensure config.txt exists
if (!fs.existsSync(CONFIG_PATH)) {
  console.log(`No config.txt found. Creating one...`);
  fs.writeFileSync(CONFIG_PATH, `EXPERIMENTAL_ARM=${arm}\n`, 'utf8');
}

// Update config.txt
console.log(`Setting EXPERIMENTAL_ARM=${arm} in config.txt...`);
let configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
const regex = /^EXPERIMENTAL_ARM=.*$/m;
if (regex.test(configContent)) {
  configContent = configContent.replace(regex, `EXPERIMENTAL_ARM=${arm}`);
} else {
  configContent += `\nEXPERIMENTAL_ARM=${arm}\n`;
}
fs.writeFileSync(CONFIG_PATH, configContent, 'utf8');

console.log(`Starting ${numRuns} consecutive sessions for arm ${arm.toUpperCase()}...\n`);

for (let i = 1; i <= numRuns; i++) {
  console.log(`\n======================================================`);
  console.log(` Starting Run ${i}/${numRuns} for Arm ${arm.toUpperCase()}`);
  console.log(`======================================================\n`);
  
  // Launch run_session.mjs synchronously
  const sessionPath = path.join(__dirname, 'run_session.mjs');
  const result = spawnSync('node', [sessionPath], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  
  if (result.error) {
    console.error(`Failed to start session: ${result.error.message}`);
    break;
  }
  
  if (result.status !== 0) {
    console.error(`\nSession ${i} exited with error code ${result.status}. Stopping batch.`);
    break;
  }
}

console.log(`\nBatch completed. Restoring default (s2e) arm.`);
configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
configContent = configContent.replace(/^EXPERIMENTAL_ARM=.*$/m, `EXPERIMENTAL_ARM=s2e`);
fs.writeFileSync(CONFIG_PATH, configContent, 'utf8');
