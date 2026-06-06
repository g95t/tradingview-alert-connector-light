import express, { Router } from 'express';
import { validateAlert } from '../services';
import { DexRegistry } from '../services/dexRegistry';

const router: Router = express.Router();

let dexRegistryInstance: DexRegistry | null = null;
function getDexRegistry(): DexRegistry {
    if (!dexRegistryInstance) {
        dexRegistryInstance = new DexRegistry();
    }
    return dexRegistryInstance;
}

router.get('/', async (req, res) => {
    res.send('OK');
});

router.get('/accounts', async (req, res) => {
    // Mantenuto per compatibilità, ma opzionale su Render Free
    // perché chiama API di tutti i DEX — può essere lento
    console.log('Received GET request.');
    try {
        const dexRegistry = getDexRegistry();
        const dexNames = ['dydxv4', 'perpetual', 'gmx', 'bluefin', 'hyperliquid', 'grvt'];
        const dexClients = dexNames.map((name) => dexRegistry.getDex(name));
        const accountStatuses = await Promise.all(
            dexClients.map((client) => client.getIsAccountReady())
        );
        const message = {
            dYdX_v4: accountStatuses[0],
            PerpetualProtocol: accountStatuses[1],
            GMX: accountStatuses[2],
            Bluefin: accountStatuses[3],
            Hyperliquid: accountStatuses[4],
            GRVT: accountStatuses[5]
        };
        res.send(message);
    } catch (error) {
        console.error('Failed to get account readiness:', error);
        if (!res.headersSent) {
            res.status(500).send('Internal server error');
        }
    }
});

router.post('/', async (req, res) => {
    try {
        console.log('Recieved Tradingview strategy alert:', req.body);
        const validated = await validateAlert(req.body);
        if (!validated) {
            res.send('Error. alert message is not valid');
            return;
        }
        const exchange = req.body['exchange']?.toLowerCase() || 'dydx';
        const dexClient = getDexRegistry().getDex(exchange);
        if (!dexClient) {
            res.send(`Error. Exchange: ${exchange} is not supported`);
            return;
        }
        const result = await dexClient.placeOrder(req.body);
        res.send('OK');
    } catch (e) {
        console.error('POST error:', e);
        if (!res.headersSent) {
            res.send('error');
        }
    }
});

export default router;
