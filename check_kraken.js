import ccxt from 'ccxt';
import 'dotenv/config';

const krakenFutures = new ccxt.krakenfutures({
    apiKey: process.env.KRAKEN_API_KEY,
    secret: process.env.KRAKEN_API_SECRET,
});

async function check() {
    try {
        const balance = await krakenFutures.fetchBalance();
        console.log('--- Kraken Futures Full Balance ---');
        console.log('Total:', balance.total.USD);
        console.log('Free/Available:', balance.free.USD);
        console.log('Used/Margin:', balance.used.USD);
        
        const pos = await krakenFutures.fetchPositions();
        console.log('\n--- Active Kraken Positions ---');
        pos.filter(p => p.contracts > 0).forEach(p => {
            console.log(`${p.symbol}: Contracts ${p.contracts}, Side ${p.side}, Entry ${p.entryPrice}, Unrealized PnL ${p.unrealizedPnl}`);
        });
    } catch (e) {
        console.error(e.message);
    }
}

check();
