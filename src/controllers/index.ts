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

        if (
            !alertMessage.passphrase ||
            alertMessage.passphrase !== process.env.TRADINGVIEW_PASSPHRASE
        ) {
            console.error('Passphrase missing or incorrect');
            res.send('Error');
            return;
        }

        if (!alertMessage.market || !alertMessage.price || !alertMessage.size || !alertMessage.order) {
            console.error('Missing required fields (market, price, size, order)');
            res.send('Error');
            return;
        }

        const price = Number(alertMessage.price);
        const size = Number(alertMessage.size);

        if (isNaN(price) || price <= 0 || !isFinite(price)) {
            console.error('Invalid price');
            res.send('Error');
            return;
        }

        if (isNaN(size) || size <= 0 || !isFinite(size)) {
            console.error('Invalid size');
            res.send('Error');
            return;
        }

        if (alertMessage.order !== 'buy' && alertMessage.order !== 'sell') {
            console.error('Invalid order direction');
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
