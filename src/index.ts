import http from 'http';
import 'dotenv/config';
import { handleRequest } from './controllers/index';

const port = process.env.PORT || 3000;

const server = http.createServer(handleRequest);

server.listen(port, () => {
    console.log(`TV-Connector web server listening on port ${port}`);
});

export { server };
