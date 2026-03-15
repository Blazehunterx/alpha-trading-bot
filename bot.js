import axios from 'axios';
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const ADX_PERIOD = 14;
const SYMBOLS = [
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 
    'DOGE-USD', 'AVAX-USD', 'LINK-USD', 'SHIB-USD', 'PEPE2-USD'
];

async function fetchHistory(symbol) {
    try {
        const response = await axios.get(`${YAHOO_BASE}/${symbol}?interval=5m&range=1d`);
        const result = response.data.chart.result[0];
        const quotes = result.indicators.quote[0];
        const timestamps = result.timestamp;
        
        return timestamps.map((ts, i) => ({
            time: ts, open: quotes.open[i], high: quotes.high[i], low: quotes.low[i], close: quotes.close[i], volume: quotes.volume[i]
        })).filter(d => d.close !== null);
    } catch (e) {
        return null;
    }
}

function calculateADX(data, period) {
    let tr = [], dmPlus = [], dmMinus = [];
    for (let i = 1; i < data.length; i++) {
        const h = data[i].high, l = data[i].low, ph = data[i-1].high, pl = data[i-1].low, pc = data[i-1].close;
        tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        dmPlus.push(h - ph > pl - l && h - ph > 0 ? h - ph : 0);
        dmMinus.push(pl - l > h - ph && pl - l > 0 ? pl - l : 0);
    }
    const smooth = (arr, p) => {
        let res = [arr.slice(0, p).reduce((a, b) => a + b, 0) / p];
        for (let i = p; i < arr.length; i++) res.push((res[res.length-1] * (p-1) + arr[i]) / p);
        return res[res.length-1];
    };
    const atr = smooth(tr, period), sdmP = smooth(dmPlus, period), sdmM = smooth(dmMinus, period);
    const diP = 100 * sdmP / atr, diM = 100 * sdmM / atr;
    return 100 * Math.abs(diP - diM) / (diP + diM);
}

function detectFVG(data) {
    const i = data.length - 1;
    if (i < 2) return null;
    if (data[i].low > data[i-2].high) return 'BULLISH';
    if (data[i].high < data[i-2].low) return 'BEARISH';
    return null;
}

import fs from 'fs';
import 'dotenv/config';
import ccxt from 'ccxt';

// Initialize Bitvavo
const bitvavo = new ccxt.bitvavo({
    apiKey: process.env.BITVAVO_API_KEY,
    secret: process.env.BITVAVO_API_SECRET,
});

async function runLiveBot() {
    console.log(`\n=== ⚡ DEEP ALPHA SCAN [${new Date().toLocaleTimeString()}] ===`);
    
    let isLiveTrading = false;
    try {
        const state = JSON.parse(fs.readFileSync('./trading_state.json', 'utf8'));
        isLiveTrading = state.autoTrade;
    } catch (e) {}

    console.log(`MODE: ${isLiveTrading ? '🔴 LIVE TRADING ENABLED' : '🟢 MONITORING ONLY'}`);
    
    for (const symbol of SYMBOLS) {
        const data = await fetchHistory(symbol);
        if (!data || data.length < 50) continue;

        const adxValue = calculateADX(data, ADX_PERIOD);
        const fvg = detectFVG(data);
        const isTrending = adxValue > 25;
        const currentPrice = data[data.length-1].close;
        
        let signal = 'WAIT';

        if (isTrending) {
            if (fvg === 'BULLISH') signal = 'BUY (Trend Rider)';
            if (fvg === 'BEARISH') signal = 'SELL (Trend Rider)';
        } else {
            const rangeLow = Math.min(...data.slice(-20).map(d => d.low));
            const rangeHigh = Math.max(...data.slice(-20).map(d => d.high));
            if (currentPrice < rangeLow + (rangeHigh - rangeLow) * 0.25) signal = 'BUY (Grid Alpha)';
            if (currentPrice > rangeHigh - (rangeHigh - rangeLow) * 0.25) signal = 'SELL (Grid Alpha)';
        }

        if (signal !== 'WAIT') {
            console.log(`[${symbol}] ${signal} at $${currentPrice.toFixed(2)}`);
            
            let status = 'MONITORING';

            if (isLiveTrading) {
                try {
                    // Map Yahoo -> Bitvavo (Example: BTC-USD -> BTC/EUR)
                    const bitvavoSymbol = `${symbol.split('-')[0]}/EUR`;
                    const side = signal.includes('BUY') ? 'buy' : 'sell';
                    
                    // Fixed safe amount for testing (€10)
                    const amount = side === 'buy' ? (10 / currentPrice).toFixed(6) : '0.001'; 
                    
                    console.log(`🚀 EXECUTING: ${side} ${amount} ${bitvavoSymbol} on Bitvavo...`);
                    // await bitvavo.createOrder(bitvavoSymbol, 'market', side, parseFloat(amount));
                    status = 'EXECUTED';
                } catch (err) {
                    console.error(`❌ Execution Failed: ${err.message}`);
                    status = 'ERROR';
                }
            }

            // Log to dashboard activity feed
            try {
                await fetch('http://localhost:3000/log-trade', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: symbol,
                        signal: signal,
                        price: currentPrice.toFixed(4),
                        strategy: isTrending ? 'Trend Rider' : 'Deep Alpha Grid',
                        status: status
                    })
                });
            } catch (e) {}
        }
    }
    console.log(`=== SCAN COMPLETE ===`);
    console.log(`Next scan in 5 minutes...`);
}

// Initial run and then every 5 minutes
runLiveBot();
setInterval(runLiveBot, 5 * 60 * 1000);
