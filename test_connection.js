import 'dotenv/config';
import ccxt from 'ccxt';

async function testConnections() {
    console.log('--- 🧪 STARTING EXCHANGE CONNECTION TEST ---');

    // 1. Bitvavo (Spot)
    console.log('\n[1/2] Connecting to Bitvavo (Spot)...');
    try {
        const bitvavo = new ccxt.bitvavo({
            apiKey: process.env.BITVAVO_API_KEY,
            secret: process.env.BITVAVO_API_SECRET,
        });
        const balance = await bitvavo.fetchBalance();
        console.log('✅ Bitvavo Success!');
        console.log(`- Balance (EUR): ${balance.total['EUR'] || 0}`);
        console.log(`- Balance (USDT): ${balance.total['USDT'] || 0}`);
    } catch (e) {
        console.error('❌ Bitvavo Connection Failed:', e.message);
    }

    // 2. BTCC (Futures/Spot)
    console.log('\n[2/2] Connecting to BTCC...');
    try {
        // BTCC usually requires a specific setup in CCXT if it's not natively supported 
        // by a top-level constructor, but we'll try the generic one first.
        const btcc = new ccxt.btcc({
            apiKey: process.env.BTCC_API_KEY,
            secret: process.env.BTCC_API_SECRET,
        });
        const balance = await btcc.fetchBalance();
        console.log('✅ BTCC Success!');
        console.log(`- Balance (USDT): ${balance.total['USDT'] || 0}`);
    } catch (e) {
        console.error('❌ BTCC Connection Failed:', e.message);
        console.log('  (Hint: BTCC might require specific CCXT configuration or endpoint)');
    }

    console.log('\n--- TEST COMPLETE ---');
}

testConnections();
