import express, { Router } from 'express';
import { DydxV4Client } from '../services/dydx_v4/dydxV4Client';

const router: Router = express.Router();
const dydxClient = new DydxV4Client();

router.get('/', async (req, res) => {
    res.send('OK');
});

router.post('/', async (req, res) => {
    try {
        const alertMessage = req.body;
        
        if (!alertMessage.passphrase || alertMessage.passphrase !== process.env.TRADINGVIEW_PASSPHRASE) {
            console.error('Passphrase missing or incorrect');
            res.send('Error');
            return;
        }

        if (!alertMessage.size || (alertMessage.order !== 'buy' && alertMessage.order !== 'sell')) {
            console.error('Missing size or invalid order direction');
            res.send('Error');
            return;
        }

        if (!alertMessage.price || !alertMessage.market) {
            console.error('Missing price or market');
            res.send('Error');
            return;
        }

        const result = await dydxClient.placeOrder(alertMessage);
        if (!result) {
            res.send('Error');
            return;
        }

        res.send('OK');
    } catch (error) {
        console.error('POST error:', error);
        if (!res.headersSent) {
            res.send('Error');
        }
    }
});

export default router;
