import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function clean() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY');
    return;
  }
  
  const res = await fetch(`${url}/rest/v1/sessions?status=eq.running`, {
    method: 'PATCH',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      status: 'aborted',
      counted: false,
      stopped_at: new Date().toISOString()
    })
  });
  
  if (res.ok) {
    console.log('Cleaned up stuck sessions:', await res.json());
  } else {
    console.error('Failed to clean up:', await res.text());
  }
}

clean();
