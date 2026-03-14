const BINANCE_BASE = 'https://api.binance.com/api/v3';

async function binanceFetch(endpoint) {
    const response = await fetch(`${BINANCE_BASE}${endpoint}`);
    if (!response.ok) throw new Error(`Binance API Error: ${response.statusText}`);
    return await response.json();
}

function calculateEMA(prices, period) {
    let k = 2 / (period + 1);
    let ema = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
        ema.push(prices[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

function calculatePOC(klines) {
    const bins = {};
    const step = 5; 
    klines.forEach(k => {
        const close = parseFloat(k[4]);
        const volume = parseFloat(k[5]);
        const bin = Math.floor(close / step) * step;
        bins[bin] = (bins[bin] || 0) + volume;
    });
    let poc = 0;
    let maxVol = 0;
    for (const bin in bins) {
        if (bins[bin] > maxVol) {
            maxVol = bins[bin];
            poc = parseFloat(bin);
        }
    }
    return poc;
}

// Risk Calculator
document.getElementById('calculate-risk').addEventListener('click', () => {
    const balance = parseFloat(document.getElementById('total-balance').value);
    const riskPercent = parseFloat(document.getElementById('risk-percent').value);
    const entry = parseFloat(document.getElementById('entry-price').value);
    const sl = parseFloat(document.getElementById('stop-loss').value);
    const leverage = parseFloat(document.getElementById('leverage').value);

    if (!balance || !entry || !sl) {
        alert('Please enter balance, entry price, and stop loss.');
        return;
    }

    const riskAmount = balance * (riskPercent / 100);
    const slDistance = Math.abs(entry - sl) / entry;
    const positionSize = riskAmount / (entry * slDistance);
    const posValue = positionSize * entry;

    document.getElementById('res-pos-size').textContent = positionSize.toFixed(4);
    document.getElementById('res-pos-value').textContent = `$${posValue.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('res-sl-dist').textContent = `${(slDistance * 100).toFixed(2)}%`;

    const resLiq = document.getElementById('res-liq-risk');
    if (leverage > (1 / slDistance)) {
        resLiq.textContent = 'CRITICAL: Liq before SL';
        resLiq.className = 'result-value status-danger';
    } else {
        resLiq.textContent = 'SAFE';
        resLiq.className = 'result-value status-success';
    }
    document.getElementById('risk-results').style.display = 'block';
});

function calculateADX(klines, period = 14) {
    if (klines.length < period * 2) return null;
    let tr = [], dmPlus = [], dmMinus = [];
    for (let i = 1; i < klines.length; i++) {
        const h = parseFloat(klines[i][2]), l = parseFloat(klines[i][3]);
        const ph = parseFloat(klines[i-1][2]), pl = parseFloat(klines[i-1][3]), pc = parseFloat(klines[i-1][4]);
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

function detectFVG(klines) {
    const i = klines.length - 1;
    if (i < 2) return null;
    const c1 = klines[i-2], c3 = klines[i];
    if (parseFloat(c3[3]) > parseFloat(c1[2])) return 'BULLISH';
    if (parseFloat(c3[2]) < parseFloat(c1[3])) return 'BEARISH';
    return null;
}

// ... (calculateEMA and calculatePOC stay the same)

// Signal Intelligence Center
document.getElementById('scan-now').addEventListener('click', async () => {
    const symbolPair = document.getElementById('symbol-select').value.replace('/', '');
    const scanBtn = document.getElementById('scan-now');
    scanBtn.textContent = 'Analyzing Regimes...';
    scanBtn.disabled = true;

    try {
        const [ticker, klines] = await Promise.all([
            binanceFetch(`/ticker/24hr?symbol=${symbolPair}`),
            binanceFetch(`/klines?symbol=${symbolPair}&interval=1h&limit=100`)
        ]);

        const currentPrice = parseFloat(ticker.lastPrice);
        const poc = calculatePOC(klines);
        const adxValue = calculateADX(klines);
        const fvg = detectFVG(klines);
        
        // Regime Detection
        const isTrending = adxValue > 25;
        const strategyName = isTrending ? 'TREND-RIDER (ICT)' : 'LIQUIDITY-FISHER (SMC)';
        
        let signal = 'WAIT';
        let signalColor = '';

        if (isTrending) {
            if (fvg === 'BULLISH' && currentPrice > poc) {
                 signal = 'LONG (ICT Trend Fvg)';
                 signalColor = 'status-success';
            } else if (fvg === 'BEARISH' && currentPrice < poc) {
                 signal = 'SHORT (ICT Trend Fvg)';
                 signalColor = 'status-danger';
            }
        } else {
            const rangeLow = Math.min(...klines.slice(-20).map(k => parseFloat(k[3])));
            const rangeHigh = Math.max(...klines.slice(-20).map(k => parseFloat(k[2])));
            
            if (currentPrice <= rangeLow * 1.002) {
                signal = 'LONG (SMC Sweep Buy)';
                signalColor = 'status-success';
            } else if (currentPrice >= rangeHigh * 0.998) {
                signal = 'SHORT (SMC Sweep Sell)';
                signalColor = 'status-danger';
            }
        }

        document.getElementById('scan-price').textContent = `$${currentPrice.toLocaleString()}`;
        document.getElementById('scan-trend').textContent = `${strategyName}`;
        document.getElementById('scan-trend').className = `result-value ${isTrending ? 'status-success' : 'status-warning'}`;
        document.getElementById('scan-rsi').textContent = `ADX: ${adxValue.toFixed(1)}`;
        document.getElementById('scan-sentiment').textContent = signal;
        document.getElementById('scan-sentiment').className = `result-value ${signalColor}`;

        document.getElementById('scan-results').style.display = 'block';

    } catch (error) {
        console.error(error);
        alert('API Rate Limit. Using local data context instead.');
    } finally {
        scanBtn.textContent = 'Generate Adaptive Signal';
        scanBtn.disabled = false;
    }
});

// Portfolio Scanner
const PORTFOLIO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'ADAUSDT', 'AVAXUSDT', 'SHIBUSDT'];

document.getElementById('portfolio-scan')?.addEventListener('click', async () => {
    const tableBody = document.getElementById('portfolio-body');
    const scanBtn = document.getElementById('portfolio-scan');
    scanBtn.textContent = 'Scanning Top Coins...';
    scanBtn.disabled = true;
    tableBody.innerHTML = '';

    for (const symbol of PORTFOLIO_SYMBOLS) {
        try {
            const [ticker, klines] = await Promise.all([
                binanceFetch(`/ticker/24hr?symbol=${symbol}`),
                binanceFetch(`/klines?symbol=${symbol}&interval=1h&limit=100`)
            ]);

            const currentPrice = parseFloat(ticker.lastPrice);
            const poc = calculatePOC(klines);
            const adxValue = calculateADX(klines);
            const fvg = detectFVG(klines);
            const isTrending = adxValue > 25;
            
            let signal = 'WAIT';
            let signalClass = '';

            if (isTrending) {
                if (fvg === 'BULLISH' && currentPrice > poc) { signal = 'LONG (ICT)'; signalClass = 'status-success'; }
                else if (fvg === 'BEARISH' && currentPrice < poc) { signal = 'SHORT (ICT)'; signalClass = 'status-danger'; }
            } else {
                const rangeLow = Math.min(...klines.slice(-20).map(k => parseFloat(k[3])));
                const rangeHigh = Math.max(...klines.slice(-20).map(k => parseFloat(k[2])));
                if (currentPrice <= rangeLow * 1.002) { signal = 'LONG (SMC)'; signalClass = 'status-success'; }
                else if (currentPrice >= rangeHigh * 0.998) { signal = 'SHORT (SMC)'; signalClass = 'status-danger'; }
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${symbol.replace('USDT', '')}</td>
                <td>$${currentPrice.toLocaleString()}</td>
                <td>${isTrending ? 'Trend' : 'Range'}</td>
                <td><span class="${signalClass}">${signal}</span></td>
            `;
            tableBody.appendChild(row);

        } catch (e) {
            console.warn(`Skip ${symbol} due to rate limit`);
        }
    }
    
    scanBtn.textContent = 'Run Portfolio Scan';
    scanBtn.disabled = false;
    document.getElementById('portfolio-results').style.display = 'block';
});
