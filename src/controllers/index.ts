import express, { Router } from 'express';
import { DydxV4Client } from '../services/dydx_v4/dydxV4Client';
import { sendNotification, formatTimestamp } from '../services/notifications/resend';

const router: Router = express.Router();
const dydxClient = new DydxV4Client();

// IP blocking for brute-force protection
const failedAttempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_FAILED_ATTEMPTS = 10;
const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function getIp(req: express.Request): string {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || 'unknown';
}

function isIpBlocked(ip: string): boolean {
    const entry = failedAttempts.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.blockedUntil) {
        failedAttempts.delete(ip);
        return false;
    }
    return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(ip: string, passphrase: unknown): void {
    if (!passphrase || typeof passphrase !== 'string' || passphrase.length <= 4) return;
    const entry = failedAttempts.get(ip) || { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILED_ATTEMPTS) {
        entry.blockedUntil = Date.now() + BLOCK_DURATION_MS;
    }
    failedAttempts.set(ip, entry);
}

// Helper: notification for auth/validation errors
function notifyValidationError(ip: string, errorDetail: string): void {
    const ts = formatTimestamp();
    const subject = 'ERROR AUTH';
    const body = `ERROR ${errorDetail} (${ip} ${ts})`;
    sendNotification(subject, body).catch(() => {});
}

// Helper: notification for order execution results
function notifyOrderResult(
    ip: string,
    success: boolean,
    retries: number,
    side: string,
    size: number,
    market: string,
    errorType?: string
): void {
    const ts = formatTimestamp();
    const direction = side.charAt(0).toUpperCase() + side.slice(1).toLowerCase();

    let statusPrefix: string;
    if (success) {
        statusPrefix = retries > 0 ? `Retry${retries} OK` : 'OK';
    } else {
        statusPrefix = retries > 0 ? `Retry${retries} ERROR` : 'ERROR';
    }

    const subject = `${statusPrefix} ${direction} ${size}`;
    const errorInfo = errorType ? ` [${errorType}]` : '';
    const body = `${statusPrefix} ${direction} ${size} ${market}${errorInfo} (${ip} ${ts})`;
    sendNotification(subject, body).catch(() => {});
}

router.get('/', async (req, res) => {
    res.send('OK');
});

router.post('/', async (req, res) => {
    const ip = getIp(req);

    try {
        // Check IP block first
        if (isIpBlocked(ip)) {
            notifyValidationError(ip, 'ip blocked');
            res.send('Error 00');
            return;
        }

        const alertMessage = req.body;

        // === PASSPHRASE CHECK ===
        if (
            !alertMessage.passphrase ||
            alertMessage.passphrase !== process.env.TRADINGVIEW_PASSPHRASE
        ) {
            const passLength = (typeof alertMessage.passphrase === 'string')
                ? String(alertMessage.passphrase).length
                : 0;
            recordFailedAttempt(ip, alertMessage.passphrase);
            notifyValidationError(ip, `passphrase ${passLength} chars`);
            res.send('Error 01');
            return;
        }

        // === REQUIRED FIELDS CHECK ===
        const missingFields: string[] = [];
        if (!alertMessage.market) missingFields.push('market');
        if (!alertMessage.size) missingFields.push('size');
        if (!alertMessage.order) missingFields.push('order');
        if (missingFields.length > 0) {
            notifyValidationError(ip, `missing ${missingFields.join(', ')}`);
            res.send('Error 02');
            return;
        }

        // === SIZE VALIDATION ===
        const size = Number(alertMessage.size);
        if (isNaN(size) || size <= 0 || !isFinite(size)) {
            notifyValidationError(ip, 'invalid size');
            res.send('Error 03');
            return;
        }
        if (size < 0.0001) {
            notifyValidationError(ip, 'size < 0.0001');
            res.send('Error 04');
            return;
        }

        // === ORDER DIRECTION CHECK ===
        if (alertMessage.order !== 'buy' && alertMessage.order !== 'sell') {
            notifyValidationError(ip, `invalid order: ${alertMessage.order}`);
            res.send('Error 05');
            return;
        }

        // === PRICE VALIDATION (optional field) ===
        if (
            alertMessage.price !== undefined &&
            alertMessage.price !== null &&
            alertMessage.price !== ''
        ) {
            const price = Number(alertMessage.price);
            if (isNaN(price) || price <= 0 || !isFinite(price)) {
                notifyValidationError(ip, 'invalid price');
                res.send('Error 06');
                return;
            }
        }

        // === PLACE ORDER ===
        const result = await dydxClient.placeOrder(alertMessage);

        if (result.success) {
            notifyOrderResult(ip, true, result.retries, result.side!, result.size!, result.market!);
            res.send('OK');
        } else {
            notifyOrderResult(
                ip,
                false,
                result.retries,
                result.side!,
                result.size!,
                result.market!,
                result.errorType
            );
            res.send('Error 07');
        }
    } catch (error) {
        console.error('POST error:', error);
        const ts = formatTimestamp();
        sendNotification('ERROR', `ERROR unexpected (${ip} ${ts})`).catch(() => {});
        if (!res.headersSent) {
            res.send('Error 08');
        }
    }
});

export default router;
