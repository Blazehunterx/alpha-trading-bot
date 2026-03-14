import axios from 'axios';
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Bot Parameters
const START_CAPITAL = 100;
const ALLOCATION_PER_TRADE = 10; // $10 per trade (max 10 open)
const ADX_PERIOD = 14;

// High Value Targets (Top 10 Crypto + Trending)
const SYMBOLS = [
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 
    'DOGE-USD', 'AVAX-USD', 'LINK-USD', 'SHIB-USD', 'PEPE2-USD'
];

async function fetchHistory(symbol) {
    try {
        const response = await axios.get(`${YAHOO_BASE}/${symbol}?interval=5m&range=2d`);
        const result = response.data.chart.result[0];
        const quotes = result.indicators.quote[0];
        const timestamps = result.timestamp;
        
        return timestamps.map((ts, i) => ({
            time: ts,
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            volume: quotes.volume[i]
        })).filter(d => d.close !== null);
    } catch (e) {
        console.error(`Fetch Error [${symbol}]:`, e.message);
        return null;
    }
}

// Indicators
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
        return res;
    };
    const atr = smooth(tr, period), sdmP = smooth(dmPlus, period), sdmM = smooth(dmMinus, period);
    const diP = sdmP.map((v, i) => 100 * v / atr[i]), diM = sdmM.map((v, i) => 100 * v / atr[i]);
    const dx = diP.map((v, i) => 100 * Math.abs(v - diM[i]) / (v + diM[i]));
    const adx = smooth(dx, period);
    return new Array(data.length - adx.length).fill(null).concat(adx);
}

function calculatePOC(data) {
    const bins = {};
    const step = 0.0001; // High precision for small coins
    data.forEach(cand => {
        const bin = Math.floor(cand.close / step) * step;
        bins[bin] = (bins[bin] || 0) + cand.volume;
    });
    let poc = 0, maxVol = 0;
    for (const bin in bins) { if (bins[bin] > maxVol) { maxVol = bins[bin]; poc = parseFloat(bin); } }
    return poc;
}

function detectFVG(data, i) {
    if (i < 2) return null;
    if (data[i].low > data[i-2].high) return 'BULLISH';
    if (data[i].high < data[i-2].low) return 'BEARISH';
    return null;
}

async function runPortfolioSimulation() {
    console.log(`\n=== PORTFOLIO ALPHA ENGINE [MULTI-COIN] ===`);
    console.log(`Starting Capital: $${START_CAPITAL} | Allocation: $${ALLOCATION_PER_TRADE}/trade`);
    
    let balance = START_CAPITAL;
    let portfolioHistory = [];
    let totalWins = 0, totalLosses = 0;
    let symbolsProcessed = 0;

    for (const symbol of SYMBOLS) {
        const data = await fetchHistory(symbol);
        if (!data) continue;
        symbolsProcessed++;

        const adx = calculateADX(data, ADX_PERIOD);
        let coinBalance = ALLOCATION_PER_TRADE; // Local balance for this specific asset simulation
        let position = null;
        let pnlForCoin = 0;

        for (let i = 50; i < data.length; i++) {
            const cand = data[i];
            const currentADX = adx[i];
            if (currentADX === null) continue;

            const isTrending = currentADX > 25;
            const lev = isTrending ? 20 : 5;
            const poc = calculatePOC(data.slice(i-50, i));

            if (position) {
                const change = (cand.close - position.entryPrice) / position.entryPrice;
                const pnl = position.type === 'LONG' ? (coinBalance * change * lev) : (coinBalance * -change * lev);

                if ((position.type === 'LONG' && change <= -(0.9/lev)) || (position.type === 'SHORT' && change >= (0.9/lev))) {
                   pnlForCoin -= coinBalance; break; 
                }

                let shouldExit = isTrending ? 
                    ((position.type === 'LONG' && cand.close < data[i-1].low) || (position.type === 'SHORT' && cand.close > data[i-1].high)) :
                    ((position.type === 'LONG' && cand.close >= poc) || (position.type === 'SHORT' && cand.close <= poc));

                if (shouldExit || Math.abs(change * lev) > 0.15) {
                    pnlForCoin += pnl;
                    if (pnl > 0) totalWins++; else totalLosses++;
                    position = null;
                }
            } else {
                if (isTrending) {
                    const fvg = detectFVG(data, i);
                    if (fvg === 'BULLISH' && cand.close > data[i-1].close) position = { type: 'LONG', entryPrice: cand.close, strategy: 'TREND' };
                    else if (fvg === 'BEARISH' && cand.close < data[i-1].close) position = { type: 'SHORT', entryPrice: cand.close, strategy: 'TREND' };
                } else {
                    const rangeLow = Math.min(...data.slice(i-20, i).map(d => d.low));
                    const rangeHigh = Math.max(...data.slice(i-20, i).map(d => d.high));
                    if (cand.low < rangeLow && cand.close > rangeLow) position = { type: 'LONG', entryPrice: cand.close, strategy: 'RANGE' };
                    else if (cand.high > rangeHigh && cand.close < rangeHigh) position = { type: 'SHORT', entryPrice: cand.close, strategy: 'RANGE' };
                }
            }
        }
        balance += pnlForCoin;
        portfolioHistory.push({ symbol, pnl: pnlForCoin.toFixed(2) });
        console.log(`- ${symbol}: ${pnlForCoin >= 0 ? '+' : ''}${pnlForCoin.toFixed(2)} USD`);
    }

    console.log(`\n================ SUMMARY ================`);
    console.log(`Coins Scanned: ${symbolsProcessed}`);
    console.log(`Final Portfolio Balance: $${balance.toFixed(2)}`);
    console.log(`Total ROI: ${(((balance - START_CAPITAL)/START_CAPITAL)*100).toFixed(2)}%`);
    console.log(`Activity: ${totalWins} Wins / ${totalLosses} Losses`);
    console.log(`==========================================\n`);
}

runPortfolioSimulation();
