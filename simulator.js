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
    return {
        adx: new Array(data.length - adx.length).fill(null).concat(adx),
        atr: new Array(data.length - atr.length).fill(null).concat(atr)
    };
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
    console.log(`\n=== DEEP ALPHA ENGINE [MULTI-COIN] ===`);
    console.log(`Starting Capital: $${START_CAPITAL} | Allocation: $${ALLOCATION_PER_TRADE}/trade`);
    
    let balance = START_CAPITAL;
    let portfolioHistory = [];
    let totalWins = 0, totalLosses = 0;
    let symbolsProcessed = 0;

    for (const symbol of SYMBOLS) {
        const data = await fetchHistory(symbol);
        if (!data) continue;
        symbolsProcessed++;

        const { adx, atr } = calculateADX(data, ADX_PERIOD);
        let coinBalance = ALLOCATION_PER_TRADE; 
        let position = null;
        let pnlForCoin = 0;

        for (let i = 50; i < data.length; i++) {
            const cand = data[i];
            const currentADX = adx[i];
            const currentATR = atr[i];
            if (currentADX === null || currentATR === null) continue;

            const isTrending = currentADX > 25;
            const lev = isTrending ? 20 : 10; // Boosted range leverage for Deep Alpha
            const poc = calculatePOC(data.slice(i-50, i));

            if (position) {
                const change = (cand.close - position.entryPrice) / position.entryPrice;
                const pnl = position.type === 'LONG' ? (coinBalance * change * lev) : (coinBalance * -change * lev);

                // ATR-based Dynamic Exit
                const exitThreshold = isTrending ? (currentATR * 2 / cand.close) : (currentATR / cand.close);
                
                if ((position.type === 'LONG' && change <= -exitThreshold) || (position.type === 'SHORT' && change >= exitThreshold)) {
                    pnlForCoin += pnl; 
                    if (pnl > 0) totalWins++; else totalLosses++;
                    position = null;
                } else if (Math.abs(change) > exitThreshold * 1.5) {
                    pnlForCoin += pnl;
                    if (pnl > 0) totalWins++; else totalLosses++;
                    position = null;
                } else if (!isTrending && Math.abs(cand.close - poc) / poc < 0.001) {
                    pnlForCoin += pnl;
                    if (pnl > 0) totalWins++; else totalLosses++;
                    position = null;
                }
            } else {
                if (isTrending) {
                    const fvg = detectFVG(data, i);
                    if (fvg === 'BULLISH' && cand.close > data[i-1].close) position = { type: 'LONG', entryPrice: cand.close };
                    else if (fvg === 'BEARISH' && cand.close < data[i-1].close) position = { type: 'SHORT', entryPrice: cand.close };
                } else {
                    // Deep Alpha Grid Logic
                    const window = data.slice(i-20, i);
                    const rangeLow = Math.min(...window.map(d => d.low));
                    const rangeHigh = Math.max(...window.map(d => d.high));
                    const rangeMid = (rangeHigh + rangeLow) / 2;
                    
                    // Signal: Grid buy near bottom quarter, Grid sell near top quarter
                    if (cand.close < rangeLow + (rangeHigh - rangeLow) * 0.25) {
                        position = { type: 'LONG', entryPrice: cand.close, strategy: 'GRID' };
                    } else if (cand.close > rangeHigh - (rangeHigh - rangeLow) * 0.25) {
                        position = { type: 'SHORT', entryPrice: cand.close, strategy: 'GRID' };
                    }
                }
            }
        }
        balance += pnlForCoin;
        console.log(`- ${symbol}: ${pnlForCoin >= 0 ? '+' : ''}${pnlForCoin.toFixed(2)} USD`);
    }

    console.log(`\n================ SUMMARY ================`);
    console.log(`Final Portfolio Balance: $${balance.toFixed(2)}`);
    console.log(`Total ROI: ${(((balance - START_CAPITAL)/START_CAPITAL)*100).toFixed(2)}%`);
    console.log(`Activity: ${totalWins} Wins / ${totalLosses} Losses`);
    console.log(`==========================================\n`);
}

runPortfolioSimulation();
