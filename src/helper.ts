import Big from 'big.js';
import { BigNumber } from 'ethers';
import { AlertObject } from './types';

export const _sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

export const getDecimalPointLength = function (number: number) {
    const numbers = String(number).split('.');
    return numbers[1] ? numbers[1].length : 0;
};

// In-memory strategy tracking (si resetta ad ogni restart, accettabile per Render Free)
const strategiesData: Record<string, any> = {};

export const getStrategiesDB = () => {
    // Ritorna un oggetto compatibile con l'API di node-json-db
    // ma tutto in memoria — niente scrittura su HD
    const db = {
        push: (path: string, value: any) => {
            const keys = path.split('/').filter(k => k);
            let obj: any = strategiesData;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!obj[keys[i]]) obj[keys[i]] = {};
                obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = value;
        },
        getData: (path: string) => {
            if (path === '/') return strategiesData;
            const keys = path.split('/').filter(k => k);
            let obj: any = strategiesData;
            for (const key of keys) {
                if (!obj[key]) return undefined;
                obj = obj[key];
            }
            return obj;
        }
    };
    return [db, strategiesData];
};

export const doubleSizeIfReverseOrder = (
    alertMessage: AlertObject,
    orderSize: number
): number => {
    if (alertMessage.reverse) {
        const [, rootData] = getStrategiesDB();
        const strategy = rootData[alertMessage.strategy];
        if (strategy && strategy.isFirstOrder === 'false') {
            return orderSize * 2;
        }
    }
    return orderSize;
};

function bigNumber2Big(value: BigNumber): Big {
	return new Big(value.toString());
}

export function bigNumber2BigAndScaleDown(
	value: BigNumber,
	decimals = 18
): Big {
	return scaleDownDecimals(bigNumber2Big(value), decimals);
}

function scaleDownDecimals(number: Big, decimals: number) {
	return number.div(new Big(10).pow(decimals));
}
