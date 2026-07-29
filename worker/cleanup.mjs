import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read config.txt from project root
const projectRoot = path.join(__dirname, '..');
const configContent = fs.readFileSync(path.join(projectRoot, 'config.txt'), 'utf8');

const getEnvVar = (name) => {
  const match = configContent.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : null;
};

const supabaseUrl = getEnvVar('SUPABASE_URL');
const supabaseKey = getEnvVar('SUPABASE_SERVICE_KEY') || getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('SUPABASE_KEY');

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: missing SUPABASE_URL or key in config.txt');
  process.exit(1);
}

async function clean() {
  console.log('Cleaning up stuck running sessions in Supabase...');
  const response = await fetch(`${supabaseUrl}/rest/v1/sessions?status=eq.running`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      status: 'aborted',
      counted: false,
      stopped_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    console.error('Failed to clean sessions:', await response.text());
  } else {
    console.log('Successfully marked all running sessions as aborted.');
  }
}

clean();
