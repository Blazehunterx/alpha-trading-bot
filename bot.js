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

function calculateWilliamsR(data, period = 14) {
    if (data.length < period) return -50;
    const subset = data.slice(-period);
    const hh = Math.max(...subset.map(d => d.high));
    const ll = Math.min(...subset.map(d => d.low));
    const close = data[data.length - 1].close;
    return ((hh - close) / (hh - ll)) * -100;
}

function detectWilliamsBreakout(data, k = 0.6) {
    const i = data.length - 1;
    if (i < 1) return null;
    const prevRange = data[i-1].high - data[i-1].low;
    const triggerPrice = data[i-1].close + (prevRange * k);
    const stopPrice = data[i-1].close - (prevRange * k);
    
    if (data[i].close > triggerPrice) return 'BULLISH_BREAKOUT';
    if (data[i].close < stopPrice) return 'BEARISH_BREAKOUT';
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
    console.log(`\n=== 🧪 PRO ALPHA SCAN [${new Date().toLocaleTimeString()}] ===`);
    
    let isLiveTrading = false;
    try {
        const state = JSON.parse(fs.readFileSync('./trading_state.json', 'utf8'));
        isLiveTrading = state.autoTrade;
    } catch (e) {}

    console.log(`MODE: ${isLiveTrading ? '🔴 LIVE TRADING ENABLED' : '🟢 MONITORING ONLY'}`);
    
    // Fetch real balance if live
    let availableBalance = 20.0;
    if (isLiveTrading) {
        try {
            const bal = await bitvavo.fetchBalance();
            availableBalance = bal.total['EUR'] || 0;
            console.log(`💰 Real Balance: ${availableBalance.toFixed(2)} EUR`);
        } catch (e) {
            console.error('Failed to fetch real balance, using safety default.');
        }
    }

    for (const symbol of SYMBOLS) {
        const data = await fetchHistory(symbol);
        if (!data || data.length < 50) continue;

        const adxValue = calculateADX(data, ADX_PERIOD);
        const fvg = detectFVG(data);
        const wR = calculateWilliamsR(data);
        const larryBreakout = detectWilliamsBreakout(data);
        const currentPrice = data[data.length-1].close;
        
        let signal = 'WAIT';
        let strategy = 'None';

        // 1. Larry Williams Volatility Breakout (Aggressive Trend)
        if (larryBreakout === 'BULLISH_BREAKOUT' && adxValue > 20) {
            signal = 'BUY (Williams Breakout)';
            strategy = 'Williams Pro';
        } else if (larryBreakout === 'BEARISH_BREAKOUT' && adxValue > 20) {
            signal = 'SELL (Williams Breakout)';
            strategy = 'Williams Pro';
        }
        // 2. Mean Reversion (Grid) if Oversold/Overbought
        else if (adxValue < 20) {
            if (wR < -80) { signal = 'BUY (Williams Oversold)'; strategy = 'Grid Alpha'; }
            if (wR > -20) { signal = 'SELL (Williams Overbought)'; strategy = 'Grid Alpha'; }
        }

        if (signal !== 'WAIT') {
            console.log(`[${symbol}] ${signal} at $${currentPrice.toFixed(4)} | wR: ${wR.toFixed(1)}`);
            
            let status = 'MONITORING';

            if (isLiveTrading && availableBalance >= 5) {
                try {
                    const bitvavoSymbol = `${symbol.split('-')[0]}/EUR`;
                    const side = signal.includes('BUY') ? 'buy' : 'sell';
                    
                    // Use 95% of balance if under 25 EUR to meet exchange minimums (typically 5-10 EUR)
                    const tradeValue = availableBalance < 25 ? availableBalance * 0.95 : availableBalance * 0.5;
                    const amount = (tradeValue / currentPrice).toFixed(6); 
                    
                    if (tradeValue < 5) {
                        console.log(`⚠️ Balance too low for minimum order (€${tradeValue.toFixed(2)})`);
                        status = 'INSUFFICIENT_FUNDS';
                    } else {
                        console.log(`🚀 EXECUTING: ${side} ${amount} ${bitvavoSymbol} on Bitvavo Pro...`);
                        
                        bitvavo.options['operatorId'] = 1773573000;
                        const order = await bitvavo.createOrder(bitvavoSymbol, 'market', side, parseFloat(amount));
                        console.log(`✅ Order Placed: ID ${order.id}`);
                        status = 'EXECUTED';
                        availableBalance -= tradeValue;
                    }
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
                        strategy: strategy,
                        status: status
                    })
                });
            } catch (e) {}
        }
    }
    console.log(`=== SCAN COMPLETE ===`);
}

// Initial run and then every 5 minutes
runLiveBot();
setInterval(runLiveBot, 5 * 60 * 1000);
