const BRIDGE_BASE = 'http://localhost:3000';

async function updatePositions() {
    try {
        const positions = await fetch(`${BRIDGE_BASE}/positions`).then(r => r.json());
        const listEl = document.getElementById('positions-list');
        
        if (!positions || positions.length === 0) {
            listEl.innerHTML = '<div class="activity-empty">Searching for entries...</div>';
            return;
        }

        listEl.innerHTML = positions.map(p => `
            <div class="activity-item" style="border-left: 4px solid ${p.exchange === 'kraken' ? '#5841d8' : 'var(--success)'}; padding: 1.5rem; margin-bottom: 1rem; background: rgba(255,255,255,0.03); border-radius: 12px;">
                <div class="activity-header" style="margin-bottom: 0.5rem;">
                    <div>
                        <span class="symbol" style="font-size: 1.4rem; font-weight: 800;">${p.symbol}</span>
                        <span class="badge" style="background: ${p.exchange === 'kraken' ? '#5841d8' : 'var(--success)'}; margin-left: 10px; font-size: 0.7rem;">${p.exchange.toUpperCase()}</span>
                    </div>
                </div>
                <div class="activity-details" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 1rem;">
                    <div><span style="color: var(--text-secondary);">Size:</span> <strong>${p.amount}</strong></div>
                    <div><span style="color: var(--text-secondary);">Entry:</span> $${p.entry.toFixed(2)}</div>
                    <div style="color: var(--success);"><span style="color: var(--text-secondary);">Target (TP):</span> $${p.tp.toFixed(2)}</div>
                    <div style="color: var(--danger);"><span style="color: var(--text-secondary);">Stop (SL):</span> $${p.sl.toFixed(2)}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.warn('Bridge not connected.');
    }
}

async function updateLiveStatus() {
    try {
        const [balanceRes, stateRes] = await Promise.all([
            fetch(`${BRIDGE_BASE}/balance`).then(r => r.json()),
            fetch(`${BRIDGE_BASE}/state`).then(r => r.json())
        ]);

        document.getElementById('bitvavo-balance').textContent = `${balanceRes.bitvavo?.toFixed(2) || '0.00'} EUR`;
        document.getElementById('kraken-balance').textContent = `${balanceRes.kraken?.toFixed(2) || '0.00'} USD`;
        
        const modeEl = document.getElementById('trading-mode');
        const toggleBtn = document.getElementById('toggle-trading');
        
        if (stateRes.autoTrade) {
            modeEl.textContent = 'LIVE TRADING';
            modeEl.style.color = 'var(--danger)';
            toggleBtn.innerHTML = '<i class="fas fa-stop"></i> DISABLE';
            toggleBtn.style.background = 'var(--danger)';
        } else {
            modeEl.textContent = 'READ-ONLY';
            modeEl.style.color = 'var(--text-secondary)';
            toggleBtn.innerHTML = '<i class="fas fa-power-off"></i> ENABLE';
            toggleBtn.style.background = 'var(--success)';
        }

        updatePositions();
    } catch (e) {
        console.warn('Bridge Offline.');
    }
}

// Refresh every 10 seconds
updateLiveStatus();
setInterval(updateLiveStatus, 10000);

document.getElementById('toggle-trading')?.addEventListener('click', async () => {
    const isLive = document.getElementById('trading-mode').textContent === 'LIVE TRADING';
    const confirmMsg = isLive ? 'Disable live trading?' : 'WARNING: Enable real trades on your account?';
    
    if (confirm(confirmMsg)) {
        await fetch(`${BRIDGE_BASE}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !isLive })
        });
        updateLiveStatus();
    }
});
