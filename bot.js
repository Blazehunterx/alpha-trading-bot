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

async function runLiveBot() {
    console.log(`\n=== ⚡ LIVE SIGNAL SCAN [${new Date().toISOString()}] ===`);
    
    let isLiveTrading = false;
    try {
        const state = JSON.parse(fs.readFileSync('./trading_state.json', 'utf8'));
        isLiveTrading = state.autoTrade;
    } catch (e) {}

    console.log(`STATUS: ${isLiveTrading ? '🔴 LIVE EXECUTION ENABLED' : '🟢 MONITORING ONLY'}`);
    
    for (const symbol of SYMBOLS) {
        const data = await fetchHistory(symbol);
        if (!data || data.length < 50) continue;

        const adxValue = calculateADX(data, ADX_PERIOD);
        const fvg = detectFVG(data);
        const isTrending = adxValue > 25;
        const currentPrice = data[data.length-1].close;
        
        let signal = 'WAIT';
        let confidence = 'LOW';

        if (isTrending) {
            if (fvg === 'BULLISH') { signal = 'BUY (Trend Gap)'; confidence = 'HIGH'; }
            if (fvg === 'BEARISH') { signal = 'SELL (Trend Gap)'; confidence = 'HIGH'; }
        } else {
            // Deep Alpha Grid Logic
            const rangeLow = Math.min(...data.slice(-20).map(d => d.low));
            const rangeHigh = Math.max(...data.slice(-20).map(d => d.high));
            if (currentPrice < rangeLow + (rangeHigh - rangeLow) * 0.25) signal = 'BUY (Deep Alpha Grid)';
            if (currentPrice > rangeHigh - (rangeHigh - rangeLow) * 0.25) signal = 'SELL (Deep Alpha Grid)';
        }

        if (signal !== 'WAIT') {
            console.log(`[${symbol}] SIGNAL: ${signal} | Price: $${currentPrice.toFixed(4)} | ADX: ${adxValue.toFixed(1)}`);
        }
    }
    console.log(`=== SCAN COMPLETE ===\n`);
}

runLiveBot();
