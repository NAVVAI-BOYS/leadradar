const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy all Enrichlayer API requests
app.post('/api/proxy', async (req, res) => {
  const { url, apiKey } = req.body;

  if (!url || !apiKey) {
    return res.status(400).json({ error: 'Missing url or apiKey' });
  }

  // Only allow Enrichlayer API calls for security
  if (!url.startsWith('https://enrichlayer.com/')) {
    return res.status(403).json({ error: 'Only Enrichlayer API calls are allowed' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Proxy for Instantly API
app.post('/api/instantly', async (req, res) => {
  const { apiKey, campaignId, leads } = req.body;

  if (!apiKey || !campaignId || !leads) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const response = await fetch('https://api.instantly.ai/api/v1/lead/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ campaign_id: campaignId, leads })
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Instantly proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LeadRadar server running on port ${PORT}`);
});
