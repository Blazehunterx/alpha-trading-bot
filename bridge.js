import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import ccxt from 'ccxt';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const STATE_FILE = './trading_state.json';

// Initialize trading state if not exists
if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ autoTrade: false }));
}

app.get('/balance', async (req, res) => {
    const results = { bitvavo: null, btcc: null, status: 'REACHABLE' };

    // Bitvavo
    try {
        const bitvavo = new ccxt.bitvavo({
            apiKey: process.env.BITVAVO_API_KEY,
            secret: process.env.BITVAVO_API_SECRET,
        });
        const bal = await bitvavo.fetchBalance();
        results.bitvavo = bal.total['EUR'] || 0;
    } catch (e) {
        console.error('Bitvavo Error:', e.message);
        results.status = 'PARTIAL_ERROR';
    }

    // BTCC (Currently limited support, we'll return 0 or placeholder if it fails)
    try {
        // Placeholder check for BTCC until direct API is wired
        results.btcc = 0.00;
    } catch (e) {
        results.status = 'PARTIAL_ERROR';
    }

    res.json(results);
});

app.get('/state', (req, res) => {
    const state = JSON.parse(fs.readFileSync(STATE_FILE));
    res.json(state);
});

app.post('/toggle', (req, res) => {
    const { enabled } = req.body;
    fs.writeFileSync(STATE_FILE, JSON.stringify({ autoTrade: enabled }));
    console.log(`📡 Trading Mode Changed: ${enabled ? 'LIVE' : 'READ-ONLY'}`);
    res.json({ success: true, autoTrade: enabled });
});

app.listen(PORT, () => {
    console.log(`🚀 Deep Alpha Bridge running at http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop the bridge.`);
});
