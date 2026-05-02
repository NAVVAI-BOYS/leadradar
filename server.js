const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
const fs = require('fs');
console.log('CWD:', process.cwd());
console.log('__dirname:', __dirname);
// public folder is inside src on Render (/opt/render/project/src/public)
const publicPath = path.join(__dirname, 'public');
console.log('Using public path:', publicPath);
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
    job_location_or: [{ id: 6252001 }], // United States
    posted_at_max_age_days: parseInt(postedDays) || 15,
    blur_company_data: false,
    include_total_results: false,
    limit: Math.min(count || 25, 25),
    page: page || 0,

    // ── Company size: 20–200 employees ──────────────────────
    min_employee_count: 20,
    max_employee_count: 200,

    // Note: Theirstack doesn't support founded year filter directly
    // We handle age filtering on the frontend based on company data returned

    // ── Tech/SaaS/B2B software industries only ───────────────
    company_industry_or: [
      "Software Development",
      "Technology, Information and Internet",
      "IT Services and IT Consulting",
      "Computer and Network Security",
      "Data Infrastructure and Analytics"
    ],

    // ── Exclude irrelevant industries ────────────────────────
    company_industry_not: [
      "Staffing and Recruiting",
      "Human Resources Services",
      "E-Learning Providers",
      "Online Media",
      "Advertising Services",
      "Entertainment Providers",
      "Retail",
      "Food and Beverage Services",
      "Hospitals and Health Care",
      "Insurance",
      "Financial Services",
      "Real Estate",
      "Construction",
      "Transportation, Logistics, Supply Chain and Storage",
      "Manufacturing",
      "Oil, Gas, and Mining"
    ],

    // ── Exclude known large enterprises ─────────────────────
    company_name_not: [
      "Amazon", "Google", "Microsoft", "Apple", "Meta", "Salesforce",
      "Oracle", "SAP", "IBM", "Adobe", "Cisco", "Dell", "HP", "Intel",
      "ServiceNow", "Workday", "HubSpot", "Zendesk", "Atlassian",
      "Twilio", "Snowflake", "Databricks", "Stripe", "Shopify"
    ],

    // ── Must be B2B / selling to businesses ─────────────────
    // Only include companies whose description mentions enterprise/business/B2B signals
    company_description_pattern_or: [
      "enterprise", "B2B", "business software", "SaaS platform",
      "software solution", "platform for", "management software",
      "workflow", "compliance", "governance", "automation platform",
      "data management", "business process", "ERP", "CRM", "cloud platform"
    ],

    // ── Exclude consumer/irrelevant description patterns ─────
    company_description_pattern_not: [
      "staffing", "recruiting", "talent agency", "job board",
      "e-learning", "online courses", "education platform",
      "food delivery", "restaurant", "social network", "consumer app",
      "marketplace for", "gig economy", "freelance platform",
      "media company", "news platform", "advertising agency",
      "open source community", "non-profit"
    ],

    // ── Funding: exclude massive VC-backed hypergrowth startups ──
    // We want established companies, not seed-stage startups
    // No filter available but we use founded year as proxy (above)

    // ── Job must be active / recently posted ─────────────────
    order_by: [{ field: "discovered_at", desc: true }]
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

// Role lookup — find person by role at a company
app.post('/api/role', async (req, res) => {
  const { apiKey, linkedin_url, company_name, role } = req.body;
  if (!apiKey || !role) return res.status(400).json({ error: 'Missing fields' });

  // Try the correct Enrichlayer endpoint for finding a person by role
  let url = `https://enrichlayer.com/api/v2/person/role?role=${encodeURIComponent(role)}&use_cache=if-present`;
  if (linkedin_url) url += `&company_linkedin_profile_url=${encodeURIComponent(linkedin_url)}`;
  if (company_name) url += `&company_name=${encodeURIComponent(company_name)}`;

  try {
    const response = await apiFetch(url, apiKey);
    const text = await response.text();
    console.log('Role lookup response:', response.status, text.slice(0, 300));
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
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
  const indexPath = path.join(__dirname, 'public', 'index.html');
  console.log('Serving index from:', indexPath);
  res.sendFile(indexPath);
});

app.listen(PORT, () => console.log(`LeadRadar running on port ${PORT}`));
