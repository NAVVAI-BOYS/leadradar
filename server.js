const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Render's CWD is /opt/render/project/src but files are at /opt/render/project/
// So we go up one level with '..'
const publicPath = path.join(process.cwd(), '..', 'public');
console.log('CWD:', process.cwd());
console.log('Serving static files from:', publicPath);
app.use(express.static(publicPath));

// Rate limiter — Enrichlayer allows 2 req/min on trial, ~10/min on paid
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
async function apiFetch(url, apiKey) {
  const gap = Date.now() - lastCall;
  if (gap < 1500) await sleep(1500 - gap);
  lastCall = Date.now();
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
  return res;
}

// Search for jobs using Theirstack — searches millions of postings across all companies
app.post('/api/jobs', async (req, res) => {
  const { tsApiKey, titles, postedDays, count, page } = req.body;
  if (!tsApiKey) return res.status(400).json({ error: 'Missing Theirstack API key' });

  const body = {
    job_title_or: titles || [],
    job_country_code_or: ['US', 'CA'],
    posted_at_max_age_days: parseInt(postedDays) || 7,
    limit: count || 50,
    page: page || 0,
    order_by: [{ field: 'discovered_at', desc: true }]
  };

  try {
    console.log('Theirstack request:', JSON.stringify(body));
    const response = await fetch('https://api.theirstack.com/v1/jobs/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tsApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    console.log('Theirstack response status:', response.status, text.slice(0, 200));
    let data;
    try { data = JSON.parse(text); } catch(e) { data = { error: text }; }
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Theirstack error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get company profile — domain, name, size, industry
app.post('/api/company', async (req, res) => {
  const { apiKey, linkedin_url } = req.body;
  if (!apiKey || !linkedin_url) return res.status(400).json({ error: 'Missing fields' });

  const url = `https://enrichlayer.com/api/v2/company?linkedin_company_profile_url=${encodeURIComponent(linkedin_url)}&use_cache=if-present`;

  try {
    const response = await apiFetch(url, apiKey);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Role lookup — correct endpoint: /api/v2/find/company/role (3 credits)
app.post('/api/role', async (req, res) => {
  const { apiKey, linkedin_url, company_name, role } = req.body;
  if (!apiKey || !role) return res.status(400).json({ error: 'Missing fields' });

  let url = `https://enrichlayer.com/api/v2/find/company/role?role=${encodeURIComponent(role)}&enrich_profile=enrich&use_cache=if-present`;
  if (linkedin_url) url += `&linkedin_company_profile_url=${encodeURIComponent(linkedin_url)}`;
  if (company_name) url += `&company_name=${encodeURIComponent(company_name)}`;

  try {
    const response = await apiFetch(url, apiKey);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test API key
app.post('/api/test', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });
  try {
    const response = await apiFetch('https://enrichlayer.com/api/v2/company?url=https://www.linkedin.com/company/apple/&use_cache=if-present', apiKey);
    const data = await response.json();
    res.json({ status: response.status, ok: response.ok, company: data.name || JSON.stringify(data).slice(0, 100) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  const indexPath = path.join(process.cwd(), '..', 'public', 'index.html');
  console.log('Serving index from:', indexPath);
  res.sendFile(indexPath);
});

app.listen(PORT, () => console.log(`LeadRadar running on port ${PORT}`));
