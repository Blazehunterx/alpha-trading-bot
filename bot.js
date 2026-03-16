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

function calculateRSI(data, period = 14) {
    if (data.length <= period) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[data.length - i].close - data[data.length - i - 1].close;
        if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i].close - data[i-1].close;
        avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateBollingerBands(data, period = 20, stdDev = 2) {
    if (data.length < period) return null;
    const subset = data.slice(-period).map(d => d.close);
    const sma = subset.reduce((a, b) => a + b, 0) / period;
    const variance = subset.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: sma + (stdDev * sd), middle: sma, lower: sma - (stdDev * sd) };
}

function detectOrderBlock(data) {
    const i = data.length - 1;
    if (i < 5) return null;
    const last3 = data.slice(-3);
    const prev3 = data.slice(-6, -3);
    const isBullReversal = last3.every(c => c.close > c.open) && prev3.every(c => c.close < c.open);
    const isBearReversal = last3.every(c => c.close < c.open) && prev3.every(c => c.close > c.open);
    if (isBullReversal) return 'BULL_OB';
    if (isBearReversal) return 'BEAR_OB';
    return null;
}

function calculateVolumeProfile(data) {
    const bins = {};
    const binSize = (Math.max(...data.map(d => d.high)) - Math.min(...data.map(d => d.low))) / 20;
    data.forEach(d => {
        const bin = Math.floor(d.close / binSize) * binSize;
        bins[bin] = (bins[bin] || 0) + d.volume;
    });
    const hvn = Object.keys(bins).reduce((a, b) => bins[a] > bins[b] ? a : b);
    return parseFloat(hvn);
}

function isHighVolatilitySession() {
    const hour = new Date().getUTCHours();
    // London: 8-16 UTC, New York: 13-21 UTC
    return (hour >= 8 && hour <= 21);
}

function checkCorrelation(symbol, activePositions) {
    const correlationGroups = {
        'MAJOR': ['BTC-USD', 'ETH-USD', 'SOL-USD'],
        'MEME': ['DOGE-USD', 'SHIB-USD', 'PEPE2-USD'],
        'ALT': ['ADA-USD', 'XRP-USD', 'AVAX-USD', 'LINK-USD']
    };
    const group = Object.keys(correlationGroups).find(g => correlationGroups[g].includes(symbol));
    if (!group) return true;
    const count = activePositions.filter(p => correlationGroups[group].includes(p.symbol)).length;
    return count < 2; // Allow max 2 per group
}

async function getFundingRate(symbol) {
    try {
        if (!symbol.includes('-USD')) return 0;
        const kSymbol = symbol.split('-')[0] + '/USD:USD';
        const funding = await krakenFutures.fetchFundingRate(kSymbol);
        return funding.fundingRate || 0;
    } catch (e) { return 0; }
}

import fs from 'fs';
import 'dotenv/config';
import ccxt from 'ccxt';

// Initialize Exchanges
const bitvavo = new ccxt.bitvavo({
    apiKey: process.env.BITVAVO_API_KEY,
    secret: process.env.BITVAVO_API_SECRET,
});

const krakenFutures = new ccxt.krakenfutures({
    apiKey: process.env.KRAKEN_API_KEY,
    secret: process.env.KRAKEN_API_SECRET,
});

// Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const POSITIONS_FILE = './positions.json';

function loadPositions() {
    try {
        if (!fs.existsSync(POSITIONS_FILE)) return [];
        return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
    } catch (e) { return []; }
}

function savePositions(positions) {
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions));
}

async function runLiveBot() {
    console.log(`\n=== 🧪 PRO ALPHA SCAN [${new Date().toLocaleTimeString()}] ===`);
    
    let isLiveTrading = false;
    try {
        const state = JSON.parse(fs.readFileSync('./trading_state.json', 'utf8'));
        isLiveTrading = state.autoTrade;
    } catch (e) {}

    console.log(`MODE: ${isLiveTrading ? '🔴 LIVE TRADING ENABLED' : '🟢 MONITORING ONLY'}`);
    
    let positions = loadPositions();
    let bitBalance = 0;
    let krakenBalance = 0;

    if (isLiveTrading) {
        try {
            const [bBal, kBal] = await Promise.all([
                bitvavo.fetchBalance().catch(() => ({ total: { EUR: 0 } })),
                krakenFutures.fetchBalance().catch(() => ({ total: { USD: 0 } }))
            ]);
            bitBalance = bBal.total['EUR'] || 0;
            krakenBalance = kBal.free['USD'] || 0;
            console.log(`💰 Balances -> Bitvavo: ${bitBalance.toFixed(2)} EUR | Kraken (F): ${krakenBalance.toFixed(2)} USD (Free)`);
        } catch (e) {
            console.error('Failed to fetch real balances.');
        }
    }

    // 1. POSITION MONITORING (TP/SL)
    for (let i = positions.length - 1; i >= 0; i--) {
        const pos = positions[i];
        const data = await fetchHistory(pos.symbol);
        if (!data) continue;
        const currentPrice = data[data.length-1].close;
        
        const isShort = pos.side === 'sell';
        let exitTriggered = false;
        let exitReason = '';

        if (isShort) {
            if (currentPrice <= pos.tp) { 
                console.log(`📈 [${pos.symbol}] TAKE PROFIT HIT! Transitioning to Trailing Profit...`);
                pos.sl = pos.tp + (pos.entry - pos.tp) * 0.2; // Move SL to lock in 80% of gain
                pos.tp = pos.tp - (pos.entry - pos.tp) * 0.5; // Next target 50% further
                savePositions(positions);
                return; // Let it run, wait for next scan
            }
            else if (currentPrice >= pos.sl) { exitTriggered = true; exitReason = 'STOP LOSS (Short)'; }
        } else {
            if (currentPrice >= pos.tp) { 
                console.log(`📈 [${pos.symbol}] TAKE PROFIT HIT! Transitioning to Trailing Profit...`);
                pos.sl = pos.tp - (pos.tp - pos.entry) * 0.2; // Move SL to lock in 80% of gain
                pos.tp = pos.tp + (pos.tp - pos.entry) * 0.5; // Next target 50% further
                savePositions(positions);
                return; // Let it run, wait for next scan
            }
            else if (currentPrice <= pos.sl) { exitTriggered = true; exitReason = 'STOP LOSS'; }
        }

        // --- NEW: Breakeven Shield ---
        if (!exitTriggered && pos.leverage >= 12 && !pos.breakevenShieldTriggered) {
             const profitPct = isShort ? (pos.entry - currentPrice) / pos.entry : (currentPrice - pos.entry) / pos.entry;
             if (profitPct >= 0.005) {
                 console.log(`🛡️ [${pos.symbol}] Breakeven Shield Activated! SL moved to $${pos.entry.toFixed(4)}`);
                 pos.sl = pos.entry;
                 pos.breakevenShieldTriggered = true;
             }
        }

        if (exitTriggered && isLiveTrading) {
            const sideToClose = pos.side === 'sell' ? 'buy' : 'sell';
            console.log(`🎯 ${exitReason} TRIGGERED: Closing ${pos.amount} ${pos.symbol} at $${currentPrice} [${pos.exchange}]`);
            try {
                if (pos.exchange === 'kraken') {
                    const kSymbol = pos.symbol.split('-')[0] + '/USD:USD';
                    await krakenFutures.createOrder(kSymbol, 'market', sideToClose, pos.amount);
                } else {
                    const bSymbol = `${pos.symbol.split('-')[0]}/EUR`;
                    bitvavo.options['operatorId'] = 1773573000;
                    await bitvavo.createOrder(bSymbol, 'market', sideToClose, pos.amount);
                }
                
                // Log Exit
                await fetch('http://localhost:3000/log-trade', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: pos.symbol, signal: `EXIT (${exitReason})`, price: currentPrice.toFixed(4),
                        strategy: 'Active Manager', status: 'EXECUTED', exchange: pos.exchange
                    })
                });

                positions.splice(i, 1);
                savePositions(positions);
            } catch (err) {
                console.error(`❌ Exit Failed: ${err.message}`);
            }
        }
    }
    // Final safety save
    savePositions(positions);

    // 2. SIGNAL SCANNING
    const isHighVol = isHighVolatilitySession();
    if (!isHighVol) console.log('🌙 Note: Current market is in Low-Volatility session (Asian hours). Filters tightened.');

    for (const symbol of SYMBOLS) {
        if (positions.find(p => p.symbol === symbol)) continue;

        const data = await fetchHistory(symbol);
        if (!data || data.length < 50) continue;

        const adxValue = calculateADX(data, ADX_PERIOD);
        const wR = calculateWilliamsR(data);
        const larryBreakout = detectWilliamsBreakout(data);
        const rsiValue = calculateRSI(data);
        const bb = calculateBollingerBands(data);
        const orderBlock = detectOrderBlock(data);
        const currentPrice = data[data.length-1].close;
        const hvn = calculateVolumeProfile(data);
        
        let signal = 'WAIT';
        let strategy = 'None';
        let confluences = [];

        // --- Master Long (Buy) Confluences ---
        if (larryBreakout === 'BULLISH_BREAKOUT') confluences.push('Trend-Breakout');
        if (wR < -85) confluences.push('Williams-Oversold');
        if (rsiValue < 30) confluences.push('RSI-Oversold');
        if (bb && currentPrice <= bb.lower) confluences.push('BB-Lower');
        if (orderBlock === 'BULL_OB') confluences.push('Institutional-OB');

        // --- Master Short (Sell) Confluences ---
        let sellConfluences = [];
        if (larryBreakout === 'BEARISH_BREAKOUT') sellConfluences.push('Trend-Breakdown');
        if (wR > -15) sellConfluences.push('Williams-Overbought');
        if (rsiValue > 70) sellConfluences.push('RSI-Overbought');
        if (bb && currentPrice >= bb.upper) sellConfluences.push('BB-Upper');
        if (orderBlock === 'BEAR_OB') sellConfluences.push('Institutional-OB');

        if (confluences.length >= 2) {
            signal = `BUY (Master Alpha: ${confluences.length}x)`;
            strategy = 'Master-Alpha';
        } else if (sellConfluences.length >= 2) {
            signal = `SELL (Master Alpha: ${sellConfluences.length}x)`;
            strategy = 'Master-Alpha';
        }

        if (signal !== 'WAIT') {
            // --- Layer 3 & 4: Quantitative Filtering ---
            if (!checkCorrelation(symbol, positions)) {
                console.log(`[${symbol}] ⚠️ REJECTED: Correlation Limit Reached for this group.`);
                signal = 'WAIT';
            }
        }

        if (signal !== 'WAIT') {
            const side = signal.startsWith('BUY') ? 'buy' : 'sell';
            const activeConfluences = side === 'buy' ? confluences : sellConfluences;
            
            // Calculate Certainty Score (0-100) - "Master Mastery" Logic
            let certainty = 50 + (activeConfluences.length * 10); 
            if (activeConfluences.includes('Institutional-OB')) certainty += 10;
            if (adxValue > 30) certainty += 5;
            
            // Layer 4 Alchemy
            const fundingRate = await getFundingRate(symbol);
            const fundingBoost = side === 'buy' ? (fundingRate < 0) : (fundingRate > 0);
            if (fundingBoost) {
                certainty += 5; // Longs get paid or Shorts get paid
                console.log(`[${symbol}] 💎 Funding Convergence Boost (+5%)`);
            }

            // HVN Magnetism
            const distToHVN = Math.abs(currentPrice - hvn) / currentPrice;
            if (distToHVN < 0.005) {
                certainty += 5;
                console.log(`[${symbol}] 🧲 High Volume Node Magnetism Boost (+5%)`);
            }

            if (isHighVol) certainty += 5;
            
            certainty = Math.min(certainty, 99);
            
            const priceDisplay = currentPrice < 0.01 ? currentPrice.toFixed(8) : currentPrice.toFixed(4);
            console.log(`[${symbol}] ${signal} at $${priceDisplay} | Confluences: ${activeConfluences.join(', ')} | Certainty: ${certainty}%`);
            
            let status = 'MONITORING';
            let exchangeToUse = null;

            if (isLiveTrading) {
                // Priority: Kraken (Futures) then Bitvavo (Spot)
                if (krakenBalance >= 10) exchangeToUse = 'kraken';
                else if (bitBalance >= 5) exchangeToUse = 'bitvavo';

                if (exchangeToUse) {
                    try {
                        let amount = 0;
                        let tradeValue = 0;
                        let leverage = 5;

                        if (exchangeToUse === 'kraken') {
                            // Use 60% of budget for trading, 40% for margin as recommended
                            tradeValue = Math.min(krakenBalance * 0.60, 50); 
                            const kSymbol = symbol.split('-')[0] + '/USD:USD';
                            
                            try { await krakenFutures.loadMarkets(); } catch (e) {}
                            
                            amount = parseFloat(krakenFutures.amountToPrecision(kSymbol, (tradeValue * leverage / currentPrice)));
                            const posValue = amount * currentPrice;
                            
                            console.log(`🚀 EXECUTING KRAKEN ${side.toUpperCase()}: ${amount} ${kSymbol} (${leverage}x Leverage) | Pos Value: $${posValue.toFixed(2)} | Est Margin: $${(posValue / leverage).toFixed(2)}`);
                            
                            await krakenFutures.createOrder(kSymbol, 'market', side, amount, undefined, { 'leverage': leverage });
                        } else {
                            if (side === 'sell') throw new Error('Bitvavo Spot does not support Shorting');
                            
                            tradeValue = bitBalance < 25 ? bitBalance * 0.95 : bitBalance * 0.5;
                            amount = parseFloat((tradeValue / currentPrice).toFixed(6));
                            const bSymbol = `${symbol.split('-')[0]}/EUR`;
                            
                            console.log(`🚀 EXECUTING BITVAVO BUY: ${amount} ${bSymbol}`);
                            bitvavo.options['operatorId'] = 1773573000;
                            await bitvavo.createOrder(bSymbol, 'market', 'buy', amount);
                        }

                        // Save Position
                        const tpDist = side === 'buy' ? 0.02 / (exchangeToUse === 'kraken' ? 2 : 1) : -0.02 / (exchangeToUse === 'kraken' ? 2 : 1);
                        const slDist = side === 'buy' ? -0.015 / (exchangeToUse === 'kraken' ? 2 : 1) : 0.015 / (exchangeToUse === 'kraken' ? 2 : 1);

                        const newPos = {
                            symbol: symbol, exchange: exchangeToUse,
                            side: side, amount: amount, entry: currentPrice,
                            leverage: exchangeToUse === 'kraken' ? leverage : 1,
                            tp: currentPrice * (1 + tpDist), 
                            sl: currentPrice * (slDist ? (1 + slDist) : (1 - 0.015)), // Safe fallback
                            time: Date.now()
                        };
                        positions.push(newPos);
                        savePositions(positions);
                        status = 'EXECUTED';

                    } catch (err) {
                        console.error(`❌ Execution Failed on ${exchangeToUse}: ${err.message}`);
                        status = 'ERROR';
                    }
                }
            }

            if (status === 'EXECUTED' || !isLiveTrading) {
                try {
                    await fetch('http://localhost:3000/log-trade', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            symbol: symbol, signal: signal, price: currentPrice.toFixed(4),
                            strategy: strategy, status: status, exchange: exchangeToUse || 'Sim'
                        })
                    });
                } catch (e) {}
            }
        }
    }
    console.log(`=== SCAN COMPLETE ===`);
}
runLiveBot();
setInterval(runLiveBot, 5 * 60 * 1000);
