import http from 'http';
import { DydxV4Client } from '../services/dydx_v4/dydxV4Client';
import { sendNotification, formatTimestamp } from '../services/notifications/resend';

const dydxClient = new DydxV4Client();

// IP blocking for brute-force protection
const failedAttempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_FAILED_ATTEMPTS = 10;
const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function getIp(req: http.IncomingMessage): string {
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

// Security headers (equivalent to helmet defaults)
function setSecurityHeaders(res: http.ServerResponse): void {
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
}

// JSON body parser with size limit (replaces express.json({ limit: '1kb' }))
function parseJsonBody(req: http.IncomingMessage, limit: number = 1024): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('Payload too large'));
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            try {
                const body = Buffer.concat(chunks).toString('utf-8');
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });

        req.on('error', reject);
    });
}

function sendPlain(res: http.ServerResponse, statusCode: number, text: string): void {
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
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

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    setSecurityHeaders(res);

    const method = req.method || 'GET';
    // Using WHATWG URL API instead of deprecated url.parse()
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // GET / — health check
    if (method === 'GET' && pathname === '/') {
        sendPlain(res, 200, 'OK');
        return;
    }

    // POST / — alert handler
    if (method === 'POST' && pathname === '/') {
        const ip = getIp(req);

        try {
            // Check IP block first
            if (isIpBlocked(ip)) {
                notifyValidationError(ip, 'ip blocked');
                sendPlain(res, 200, 'Error 00');
                return;
            }

            // Parse JSON body with 1KB limit
            let alertMessage: any;
            try {
                alertMessage = await parseJsonBody(req, 1024);
            } catch {
                sendPlain(res, 400, 'Invalid request body');
                return;
            }

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
                sendPlain(res, 200, 'Error 01');
                return;
            }

            // === REQUIRED FIELDS CHECK ===
            const missingFields: string[] = [];
            if (!alertMessage.market) missingFields.push('market');
            if (!alertMessage.size) missingFields.push('size');
            if (!alertMessage.order) missingFields.push('order');
            if (missingFields.length > 0) {
                notifyValidationError(ip, `missing ${missingFields.join(', ')}`);
                sendPlain(res, 200, 'Error 02');
                return;
            }

            // === SIZE VALIDATION ===
            const size = Number(alertMessage.size);
            if (isNaN(size) || size <= 0 || !isFinite(size)) {
                notifyValidationError(ip, 'invalid size');
                sendPlain(res, 200, 'Error 03');
                return;
            }
            if (size < 0.0001) {
                notifyValidationError(ip, 'size < 0.0001');
                sendPlain(res, 200, 'Error 04');
                return;
            }

            // === ORDER DIRECTION CHECK ===
            if (alertMessage.order !== 'buy' && alertMessage.order !== 'sell') {
                notifyValidationError(ip, `invalid order: ${alertMessage.order}`);
                sendPlain(res, 200, 'Error 05');
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
                    sendPlain(res, 200, 'Error 06');
                    return;
                }
            }

            // === PLACE ORDER ===
            const result = await dydxClient.placeOrder(alertMessage);

            if (result.success) {
                notifyOrderResult(ip, true, result.retries, result.side!, result.size!, result.market!);
                sendPlain(res, 200, 'OK');
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
                sendPlain(res, 200, 'Error 07');
            }
        } catch (error) {
            console.error('POST error:', error);
            const ts = formatTimestamp();
            sendNotification('ERROR', `ERROR unexpected (${ip} ${ts})`).catch(() => {});
            if (!res.headersSent) {
                sendPlain(res, 200, 'Error 08');
            }
        }
        return;
    }

    // All other routes — 404
    sendPlain(res, 404, 'Not Found');
}
