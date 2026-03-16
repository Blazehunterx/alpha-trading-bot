import axios from 'axios';
import fs from 'fs';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

async function fetchPrice(symbol) {
    try {
        const response = await axios.get(`${YAHOO_BASE}/${symbol}?interval=1m&range=1d`);
        const result = response.data.chart.result[0];
        const quotes = result.indicators.quote[0];
        const validPrices = quotes.close.filter(p => p !== null);
        const lastPrice = validPrices[validPrices.length - 1];
        return lastPrice;
    } catch (e) {
        return null;
    }
}

async function check() {
    const positions = JSON.parse(fs.readFileSync('./positions.json', 'utf8'));
    console.log('--- Current Positions Status ---');
    for (const pos of positions) {
        const current = await fetchPrice(pos.symbol);
        const pnl = pos.side === 'buy' ? 
            (current - pos.entry) / pos.entry * 100 : 
            (pos.entry - current) / pos.entry * 100;
        
        console.log(`${pos.symbol}: Entry ${pos.entry.toFixed(2)}, Current ${current?.toFixed(2)}, PnL ${pnl.toFixed(2)}%`);
    }
}

check();
