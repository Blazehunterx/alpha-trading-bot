import axios from 'axios';
import fs from 'fs';
import 'dotenv/config';
import ccxt from 'ccxt';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const ADX_PERIOD = 14;
const SYMBOLS = [
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 
    'DOGE-USD', 'AVAX-USD', 'LINK-USD', 'SHIB-USD', 'PEPE2-USD',
    'MATIC-USD', 'DOT-USD', 'LTC-USD', 'BCH-USD', 'UNI-USD',
    'RENDER-USD', 'SUI-USD', 'APT-USD', 'TIA-USD', 'INJ-USD'
];

const POSITIONS_FILE = './positions.json';
const LOG_FILE = './trade_activity.log';

// --- Exchange Initialization ---
const bitvavo = new ccxt.bitvavo({ apiKey: process.env.BITVAVO_API_KEY, secret: process.env.BITVAVO_API_SECRET });
const krakenFutures = new ccxt.krakenfutures({ apiKey: process.env.KRAKEN_API_KEY, secret: process.env.KRAKEN_API_SECRET });

function log(msg) {
    const t = new Date().toLocaleString();
    const line = `[${t}] ${msg}\n`;
    console.log(line.trim());
    fs.appendFileSync(LOG_FILE, line);
}

// --- Technical Indicators ---
async function fetchHistory(symbol) {
    try {
        const response = await axios.get(`${YAHOO_BASE}/${symbol}?interval=5m&range=1d`);
        const result = response.data.chart.result[0];
        const quotes = result.indicators.quote[0];
        const timestamps = result.timestamp;
        return timestamps.map((ts, i) => ({
            time: ts, open: quotes.open[i], high: quotes.high[i], low: quotes.low[i], close: quotes.close[i], volume: quotes.volume[i]
        })).filter(d => d.close !== null);
    } catch (e) { return null; }
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

function calculateWilliamsR(data, period = 14) {
    if (data.length < period) return -50;
    const subset = data.slice(-period);
    const hh = Math.max(...subset.map(d => d.high));
    const ll = Math.min(...subset.map(d => d.low));
    return ((hh - data[data.length-1].close) / (hh - ll)) * -100;
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
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
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
    return isBullReversal ? 'BULL_OB' : (isBearReversal ? 'BEAR_OB' : null);
}

function calculateVolumeProfile(data) {
    const bins = {};
    const prices = data.map(d => d.close);
    const min = Math.min(...prices), max = Math.max(...prices);
    const binSize = (max - min) / 20 || 0.0001;
    data.forEach(d => {
        const bin = Math.floor(d.close / binSize) * binSize;
        bins[bin] = (bins[bin] || 0) + d.volume;
    });
    return parseFloat(Object.keys(bins).reduce((a, b) => bins[a] > bins[b] ? a : b));
}

async function getFundingRate(symbol) {
    try {
        const kSymbol = symbol.split('-')[0] + '/USD:USD';
        const funding = await krakenFutures.fetchFundingRate(kSymbol);
        return funding.fundingRate || 0;
    } catch (e) { return 0; }
}

function checkCorrelation(symbol, activePositions) {
    const groups = { 'MAJOR': ['BTC-USD', 'ETH-USD', 'SOL-USD'], 'MEME': ['DOGE-USD', 'SHIB-USD', 'PEPE2-USD'], 'ALT': ['ADA-USD', 'XRP-USD', 'AVAX-USD', 'LINK-USD', 'MATIC-USD', 'DOT-USD'] };
    const group = Object.keys(groups).find(g => groups[g].includes(symbol));
    return group ? activePositions.filter(p => groups[group].includes(p.symbol)).length < 3 : true;
}

// --- Core Logic ---
function loadPositions() { try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch (e) { return []; } }
function savePositions(positions) { fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2)); }

async function runLiveBot() {
    log(`--- 🦅 QUANT EAGLE V5: WALL STREET PROTOCOL ---`);
    let isLiveTrading = false;
    try { isLiveTrading = JSON.parse(fs.readFileSync('./trading_state.json', 'utf8')).autoTrade; } catch (e) {}

    let positions = loadPositions();
    let krakenBalance = 0;
    let totalEquity = 0;

    if (isLiveTrading) {
        try {
            const kBal = await krakenFutures.fetchBalance();
            krakenBalance = kBal.info?.accounts?.flex?.availableMargin || kBal.free['USD'] || 0;
            totalEquity = kBal.info?.accounts?.flex?.marginEquity || kBal.total['USD'] || 0;
            log(`Wallet -> Power: $${parseFloat(krakenBalance).toFixed(2)} | Equity: $${parseFloat(totalEquity).toFixed(2)} | Progress: ${((totalEquity/500)*100).toFixed(1)}%`);
        } catch (e) { log('Balance check failed.'); }
    }

    // 1. POSITION MANAGEMENT (Trailing Guard)
    for (let i = positions.length - 1; i >= 0; i--) {
        const pos = positions[i];
        const data = await fetchHistory(pos.symbol);
        if (!data) continue;
        const currentPrice = data[data.length-1].close;
        const isShort = pos.side === 'sell';
        let exitTriggered = false, exitReason = '';

        if (isShort) {
            if (currentPrice <= pos.tp) {
                log(`💹 [${pos.symbol}] Profit Target Hit! Locking 1.5% breathing room.`);
                const newSl = currentPrice * 1.015;
                if (!pos.sl || newSl < pos.sl) pos.sl = newSl;
                pos.tp = currentPrice * 0.98;
                savePositions(positions);
                continue;
            } else if (currentPrice >= pos.sl) { exitTriggered = true; exitReason = 'TRAILING STOP'; }
        } else {
            if (currentPrice >= pos.tp) {
                log(`💹 [${pos.symbol}] Profit Target Hit! Locking 1.5% breathing room.`);
                const newSl = currentPrice * 0.985;
                if (!pos.sl || newSl > pos.sl) pos.sl = newSl;
                pos.tp = currentPrice * 1.02;
                savePositions(positions);
                continue;
            } else if (currentPrice <= pos.sl) { exitTriggered = true; exitReason = 'TRAILING STOP'; }
        }

        if (exitTriggered && isLiveTrading) {
            log(`🎯 EXIT: Closing ${pos.symbol} at $${currentPrice.toFixed(4)} [${exitReason}]`);
            try {
                if (pos.exchange === 'kraken') {
                    const kSymbol = pos.symbol.split('-')[0] + '/USD:USD';
                    await krakenFutures.createOrder(kSymbol, 'market', isShort ? 'buy' : 'sell', pos.amount, undefined, { 'reduceOnly': true });
                } else {
                    // Bitvavo fallback (ensure EUR pair name)
                    const bSymbol = `${pos.symbol.split('-')[0]}/EUR`;
                    await bitvavo.createOrder(bSymbol, 'market', isShort ? 'buy' : 'sell', pos.amount);
                }
                positions.splice(i, 1);
                savePositions(positions);
            } catch (err) { 
                if (err.message.includes('wouldNotReducePosition')) {
                    log(`⚠️ [Sync] ${pos.symbol} already closed on exchange. Removing from local tracker.`);
                    positions.splice(i, 1);
                    savePositions(positions);
                } else {
                    log(`❌ Exit Fail: ${err.message}`); 
                }
            }
        }
    }

    // 2. ENTRY SCANNING (High Confluence)
    for (const symbol of SYMBOLS) {
        if (positions.find(p => p.symbol === symbol)) continue;
        const data = await fetchHistory(symbol);
        if (!data || data.length < 50) continue;

        const wR = calculateWilliamsR(data), rsi = calculateRSI(data), bb = calculateBollingerBands(data);
        const ob = detectOrderBlock(data), hvn = calculateVolumeProfile(data), adx = calculateADX(data, ADX_PERIOD);
        const currentPrice = data[data.length-1].close, funding = await getFundingRate(symbol);

        let confluences = [];
        if (wR < -85) confluences.push('W%R-OS');
        if (rsi < 35) confluences.push('RSI-OS');
        if (bb && currentPrice <= bb.lower) confluences.push('BB-Lower');
        if (ob === 'BULL_OB') confluences.push('OrderBlock');
        if (currentPrice > hvn) confluences.push('Above-HVN');
        if (funding < 0) confluences.push('Funding-Bull');

        let bearConf = [];
        if (wR > -15) bearConf.push('W%R-OB');
        if (rsi > 65) bearConf.push('RSI-OB');
        if (bb && currentPrice >= bb.upper) bearConf.push('BB-Upper');
        if (ob === 'BEAR_OB') bearConf.push('OrderBlock');
        if (currentPrice < hvn) bearConf.push('Below-HVN');
        if (funding > 0) bearConf.push('Funding-Bear');

        let signal = confluences.length >= 3 ? 'BUY' : (bearConf.length >= 3 ? 'SELL' : null);

        if (signal && isLiveTrading) {
            if (krakenBalance < 15 || !checkCorrelation(symbol, positions)) continue;
            const side = signal.toLowerCase(), activeConf = side === 'buy' ? confluences : bearConf;
            const leverage = activeConf.length >= 4 ? 10 : 5;
            const tradeValue = 40; 

            try {
                const kSymbol = symbol.split('-')[0] + '/USD:USD';
                const amount = parseFloat(krakenFutures.amountToPrecision(kSymbol, (tradeValue * leverage / currentPrice)));
                log(`🚀 ENTRY: ${signal} ${symbol} | Leverage: ${leverage}x | Conf: ${activeConf.join(', ')}`);
                await krakenFutures.createOrder(kSymbol, 'market', side, amount, undefined, { 'leverage': leverage });
                positions.push({ symbol, exchange: 'kraken', side, amount, entry: currentPrice, tp: currentPrice * (side === 'buy' ? 1.01 : 0.99), sl: currentPrice * (side === 'buy' ? 0.985 : 1.015), time: Date.now() });
                savePositions(positions);
            } catch (err) { log(`❌ Entry Fail: ${err.message}`); }
        }
    }
    log(`--- SCAN COMPLETE ---`);
}

setInterval(runLiveBot, 60 * 1000);
runLiveBot();
log("Quant Eagle V5: Wall Street Protocol Active. Objective: $500.");
