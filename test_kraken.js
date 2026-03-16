import ccxt from 'ccxt';
import 'dotenv/config';

async function testKraken() {
    console.log('--- Kraken Connection Test ---');
    
    // 1. FUTURES TEST (Priority)
    console.log('\n--- Part 1: Testing Kraken FUTURES ---');
    try {
        const krakenFutures = new ccxt.krakenfutures({
            apiKey: process.env.KRAKEN_API_KEY,
            secret: process.env.KRAKEN_API_SECRET
        });
        
        console.log('Attempting to fetch Futures markets...');
        const markets = await krakenFutures.fetchMarkets();
        console.log(`✅ Loaded ${markets.length} Futures markets.`);
        
        const fBal = await krakenFutures.fetchBalance();
        console.log('✅ Kraken FUTURES Balance Fetch Successful!');
        console.log('Futures Total Balances:', JSON.stringify(fBal.total, null, 2));
    } catch (fe) {
        console.error('❌ Kraken FUTURES Test Failed:');
        console.error(fe.message);
    }

    // 2. SPOT TEST
    console.log('\n--- Part 2: Testing Kraken SPOT ---');
    try {
        const kraken = new ccxt.kraken({
            apiKey: process.env.KRAKEN_API_KEY,
            secret: process.env.KRAKEN_API_SECRET
        });

        const bal = await kraken.fetchBalance();
        console.log('✅ Kraken SPOT Connection Successful!');
        console.log('Spot Balances:', JSON.stringify(bal.total, null, 2));
    } catch (se) {
        console.error('❌ Kraken SPOT Test Failed (Expected if this is a Futures-only key):');
        console.error(se.message);
    }
}

testKraken();
