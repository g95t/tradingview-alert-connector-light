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
            res.send('Error 01');
            return;
        }

        if (!alertMessage.market || !alertMessage.size || !alertMessage.order) {
            console.error('Missing required fields (market, size, order)');
            res.send('Error 02');
            return;
        }

        const size = Number(alertMessage.size);

        if (isNaN(size) || size <= 0 || !isFinite(size)) {
            console.error('Invalid size');
            res.send('Error 03');
            return;
        }

        if (size < 0.0001) {
            console.error('Size below minimum (0.0001)');
            res.send('Error 04');
            return;
        }

        if (alertMessage.order !== 'buy' && alertMessage.order !== 'sell') {
            console.error('Invalid order direction');
            res.send('Error 05');
            return;
        }

        if (alertMessage.price !== undefined && alertMessage.price !== null && alertMessage.price !== '') {
            const price = Number(alertMessage.price);
            if (isNaN(price) || price <= 0 || !isFinite(price)) {
                console.error('Invalid price');
                res.send('Error 06');
                return;
            }
        }

        const result = await dydxClient.placeOrder(alertMessage);
        if (!result) {
            res.send('Error 07');
            return;
        }

        res.send('OK');
    } catch (error) {
        console.error('POST error:', error);
        if (!res.headersSent) {
            res.send('Error 08');
        }
    }
});

export default router;
