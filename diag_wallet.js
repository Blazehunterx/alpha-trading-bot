import ccxt from 'ccxt';
import 'dotenv/config';

async function check() {
    const bit = new ccxt.bitvavo({ apiKey: process.env.BITVAVO_API_KEY, secret: process.env.BITVAVO_API_SECRET });
    const kra = new ccxt.kraken({ apiKey: process.env.KRAKEN_API_KEY, secret: process.env.KRAKEN_API_SECRET });
    const kf = new ccxt.krakenfutures({ apiKey: process.env.KRAKEN_API_KEY, secret: process.env.KRAKEN_API_SECRET });

    const [bBal, kBal, kfBal] = await Promise.all([
        bit.fetchBalance().catch(e => ({ total: { EUR: 0 }})),
        kra.fetchBalance().catch(e => ({ total: { EUR: 0, USD: 0 }})),
        kf.fetchBalance().catch(e => ({ total: { USD: 0 }, free: { USD: 0 }}))
    ]);

    console.log('--- GLOBAL WALLET ---');
    console.log('Bitvavo EUR:', bBal.total.EUR || 0);
    console.log('Kraken Spot EUR:', kBal.total.EUR || 0);
    console.log('Kraken Spot USD:', kBal.total.USD || 0);
    console.log('Kraken Futures Total USD:', kfBal.total.USD || 0);
    console.log('Kraken Futures Free USD:', kfBal.free.USD || 0);
}
check();
