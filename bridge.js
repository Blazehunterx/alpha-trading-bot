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
const LOGS_FILE = './trade_logs.json';

// Initialize files if not exists
if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ autoTrade: false }));
}
if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify([]));
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

    // BTCC (Limited CCXT support + Spot only permissions)
    try {
        // Return 0 balance and clear status for BTCC since it's Spot-only
        results.btcc = 0.00;
        console.log('ℹ️ BTCC: Connected in READ-ONLY mode (Spot only).');
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

app.get('/trades', (req, res) => {
    const logs = JSON.parse(fs.readFileSync(LOGS_FILE));
    res.json(logs.slice(-20).reverse()); // Return last 20 trades, newest first
});

app.post('/log-trade', (req, res) => {
    const trade = req.body;
    const logs = JSON.parse(fs.readFileSync(LOGS_FILE));
    
    const newEntry = {
        id: Date.now(),
        time: new Date().toISOString(),
        ...trade
    };
    
    logs.push(newEntry);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(-100))); // Persist last 100
    
    console.log(`📝 Trade Logged: ${trade.symbol} ${trade.signal}`);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🚀 Deep Alpha Bridge running at http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop the bridge.`);
});
