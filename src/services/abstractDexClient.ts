import * as fs from 'fs';
import { getStrategiesDB } from '../helper';
import config from 'config';
import { AlertObject, OrderResult } from '../types';

export abstract class AbstractDexClient {
	abstract getIsAccountReady(): Promise<boolean>;
	abstract placeOrder(alertMessage: AlertObject);

	exportOrder = async (
	    exchange: string,
	    strategy: string,
	    orderResult: OrderResult,
	    tradingviewPrice: number,
	    market: string
	) => {
	    // 1. In-memory strategy tracking (same as before, just no HD)
	    const [db, rootData] = getStrategiesDB();
	    const rootPath = '/' + strategy;
	    const isFirstOrderPath = rootPath + '/isFirstOrder';
	    db.push(isFirstOrderPath, 'false');
	
	    const orderSize = Number(orderResult.size);
	    const positionPath = rootPath + '/position';
	    const position = orderResult.side == 'BUY' ? orderSize : -1 * orderSize;
	    const storedSize = rootData[strategy]?.position
	        ? rootData[strategy].position
	        : 0;
	    db.push(positionPath, storedSize + position);
	
	    // 2. CSV export — best-effort, non crashare se il FS non è disponibile
	    try {
	        const environment =
	            config.util.getEnv('NODE_ENV') == 'production' ? 'mainnet' : 'testnet';
	        const folderPath = './data/exports/' + environment;
	        if (!fs.existsSync(folderPath)) {
	            fs.mkdirSync(folderPath, { recursive: true });
	        }
	        const fullPath = folderPath + `/tradeHistory${exchange}.csv`;
	        if (!fs.existsSync(fullPath)) {
	            const headerString =
	                'datetime,strategy,market,side,size,tradingviewPrice,order_id';
	            fs.writeFileSync(fullPath, headerString);
	        }
	        const date = new Date();
	        const appendArray = [
	            date.toISOString(),
	            strategy,
	            market,
	            orderResult.side,
	            orderResult.size,
	            tradingviewPrice,
	            orderResult.orderId
	        ];
	        const appendString = '\r\n' + appendArray.join();
	        fs.appendFileSync(fullPath, appendString);
	    } catch (err) {
	        console.warn('CSV export skipped:', (err as Error).message);
	    }
	};
}
