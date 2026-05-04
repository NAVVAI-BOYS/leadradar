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
    // Job title keywords — exact from Theirstack cURL
    job_title_or: [
      "marketing", "outbound", "growth", "demand", "sales", "business development"
    ],

    // North America location ID (from Theirstack cURL)
    job_location_or: [{ id: 6255149 }],

    // Posted within X days
    posted_at_max_age_days: parseInt(postedDays) || 15,

    // Industry IDs — 6=Software Dev, 43=IT Services, 11=Tech/Internet, 2401=Data/Analytics, 96=Cybersecurity
    industry_id_or: [6, 43, 11, 2401, 96],

    // Company size: 20-200 employees
    min_employee_count: 20,
    max_employee_count: 200,

    // Exclude large enterprises
    company_name_not: [
      "Amazon", "Google", "Microsoft", "Apple", "Meta", "Salesforce",
      "Oracle", "SAP", "IBM", "Adobe", "Cisco", "Dell", "HP", "Intel",
      "ServiceNow", "Workday", "HubSpot", "Zendesk", "Atlassian",
      "Twilio", "Snowflake", "Databricks", "Stripe", "Shopify"
    ],

    blur_company_data: false,
    include_total_results: false,
    limit: Math.min(count || 25, 25),
    page: page || 0,
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

// Anymailfinder — find decision maker email by category
async function findDecisionMakerEmail(amfApiKey, domain, category) {
  try {
    const response = await fetch('https://api.anymailfinder.com/v5.1/find-email/decision-maker', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${amfApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ domain, decision_maker_category: category })
    });
    const data = await response.json();
    console.log(`AMF ${category} for ${domain}:`, response.status, JSON.stringify(data).slice(0, 200));
    return data;
  } catch (err) {
    console.error('AMF error:', err.message);
    return null;
  }
}

// Map job titles to relevant Anymailfinder decision maker category
function getRelevantCategory(jobTitles) {
  const jobs = (jobTitles || []).join(' ').toLowerCase();
  if (/demand|lead gen|digital market|inbound|content|product market|growth market/.test(jobs)) return 'cmo';
  if (/vp market|head of market|director of market/.test(jobs)) return 'vp_marketing';
  if (/sales|business dev|outbound|sdr|bdr|revenue/.test(jobs)) return 'vp_sales';
  if (/growth/.test(jobs)) return 'cmo';
  return 'cmo';
}

// Find 2 contacts: CEO + role-relevant decision maker
// Supports domain OR company name lookup
app.post('/api/contacts', async (req, res) => {
  const { amfApiKey, domain, companyName, jobTitles } = req.body;
  if (!amfApiKey || (!domain && !companyName)) return res.status(400).json({ error: 'Missing fields' });

  const relevantCategory = getRelevantCategory(jobTitles);
  const contacts = [];

  // Build lookup params — prefer domain, fallback to company name
  async function findEmail(category) {
    try {
      const body = { decision_maker_category: category };
      if (domain) body.domain = domain;
      else body.company_name = companyName;

      const response = await fetch('https://api.anymailfinder.com/v5.1/find-email/decision-maker', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${amfApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      console.log(`AMF ${category} for ${domain || companyName}:`, response.status, JSON.stringify(data).slice(0, 200));
      return data;
    } catch(err) {
      console.error('AMF error:', err.message);
      return null;
    }
  }

  // Contact 1: CEO/Founder always
  const ceoResult = await findEmail('ceo');
  if (ceoResult && ceoResult.email) {
    contacts.push({
      email: ceoResult.email,
      firstName: ceoResult.first_name || '',
      lastName: ceoResult.last_name || '',
      title: ceoResult.position || 'CEO / Founder',
      verified: ceoResult.status === 'valid'
    });
  }

  await sleep(1000);

  // Contact 2: Role-relevant decision maker
  const roleResult = await findEmail(relevantCategory);
  if (roleResult && roleResult.email) {
    if (!contacts.length || roleResult.email !== contacts[0].email) {
      contacts.push({
        email: roleResult.email,
        firstName: roleResult.first_name || '',
        lastName: roleResult.last_name || '',
        title: roleResult.position || relevantCategory.replace(/_/g,' ').toUpperCase(),
        verified: roleResult.status === 'valid'
      });
    }
  }

  res.json({ contacts, relevantCategory });
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  console.log('Serving index from:', indexPath);
  res.sendFile(indexPath);
});

app.listen(PORT, () => console.log(`LeadRadar running on port ${PORT}`));
