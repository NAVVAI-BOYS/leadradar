const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Generic proxy for Enrichlayer
app.post('/api/proxy', async (req, res) => {
  const { url, apiKey } = req.body;
  if (!url || !apiKey) return res.status(400).json({ error: 'Missing url or apiKey' });
  if (!url.startsWith('https://enrichlayer.com/')) return res.status(403).json({ error: 'Only Enrichlayer URLs allowed' });

  try {
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Job search
app.post('/api/jobs', async (req, res) => {
  const { apiKey, keyword, when, count, start } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });

  let url = `https://enrichlayer.com/api/v2/company/job?keyword=${encodeURIComponent(keyword)}&count=${count || 25}`;
  if (when) url += `&when=${when}`;
  if (start) url += `&start=${start}`;

  try {
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Company profile
app.post('/api/company', async (req, res) => {
  const { apiKey, linkedin_url, name } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });

  let url = linkedin_url
    ? `https://enrichlayer.com/api/v2/company?linkedin_company_profile_url=${encodeURIComponent(linkedin_url)}&use_cache=if-present`
    : `https://enrichlayer.com/api/v2/company/resolve?company_name=${encodeURIComponent(name)}&use_cache=if-present`;

  try {
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Employee/people search at a company
app.post('/api/people', async (req, res) => {
  const { apiKey, linkedin_url, domain, role_titles, count } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });

  const companyParam = linkedin_url
    ? `linkedin_company_profile_url=${encodeURIComponent(linkedin_url)}`
    : `company_domain=${encodeURIComponent(domain)}`;

  const roleQuery = (role_titles || []).slice(0, 8).join(' OR ');
  const url = `https://enrichlayer.com/api/v2/company/employee?${companyParam}&boolean_role_search=${encodeURIComponent(roleQuery)}&count=${count || 10}&enrich_profiles=enrich&use_cache=if-present`;

  try {
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Work email lookup
app.post('/api/email', async (req, res) => {
  const { apiKey, linkedin_url } = req.body;
  if (!apiKey || !linkedin_url) return res.status(400).json({ error: 'Missing fields' });

  const url = `https://enrichlayer.com/api/v2/person/email?linkedin_profile_url=${encodeURIComponent(linkedin_url)}`;
  try {
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Instantly push
app.post('/api/instantly', async (req, res) => {
  const { apiKey, campaignId, leads } = req.body;
  if (!apiKey || !campaignId || !leads) return res.status(400).json({ error: 'Missing fields' });

  try {
    const response = await fetch('https://api.instantly.ai/api/v1/lead/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ campaign_id: campaignId, leads })
    });
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
    const response = await fetch('https://enrichlayer.com/api/v2/company?linkedin_company_profile_url=https://www.linkedin.com/company/apple&use_cache=if-present', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await response.json();
    res.json({ status: response.status, ok: response.ok, company: data.name || 'unknown' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`LeadRadar running on port ${PORT}`));
