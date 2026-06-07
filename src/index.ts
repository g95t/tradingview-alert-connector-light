// ── Patch url.parse with WHATWG URL API ──
const nodeUrl = require('url') as typeof import('url');
type UrlParseResult = ReturnType<typeof nodeUrl.parse>;
const _origParse = nodeUrl.parse;
(nodeUrl as any).parse = function patchedParse(
    input: string,
    parseQueryString?: boolean,
    slashesDenoteHost?: boolean
): UrlParseResult {
    try {
        const u = new URL(input);
        return {
            protocol: u.protocol || null,
            slashes: u.protocol ? u.protocol.endsWith(':') : null,
            auth: (u.username || u.password) ? `${u.username}:${u.password}` : null,
            host: u.host || null,
            port: u.port || null,
            hostname: u.hostname || null,
            hash: u.hash || null,
            search: u.search || null,
            query: u.search ? u.search.slice(1) : null,
            pathname: u.pathname || null,
            path: `${u.pathname || ''}${u.search || ''}`,
            href: u.href || null,
        } as UrlParseResult;
    } catch {
        return _origParse.call(nodeUrl, input, parseQueryString as any, slashesDenoteHost as any);
    }
};
// ── End patch ──

const http = require('http') as typeof import('http');
require('dotenv/config');
const { handleRequest } = require('./controllers/index') as {
    handleRequest: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>;
};

// PORT is automatically set by Render.com — do not add to .env
const port = process.env.PORT || 3000;

const server = http.createServer(handleRequest);

server.listen(port, () => {
    console.log(`TV-Connector web server listening on port ${port}`);
});
