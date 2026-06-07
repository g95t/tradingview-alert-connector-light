import { OrderSide as v4OrderSide } from '@dydxprotocol/v4-client-js';

export type AlertObject = {
    market: string;
    size: number;
    order: string;
    price?: number;
    passphrase: string;
};

export type dydxV4OrderParams = {
    market: string;
    side: v4OrderSide;
    size: number;
    price: number;
};

export type PlaceOrderResult = {
    success: boolean;
    retries: number;
    errorType?: 'connection' | 'order';
    side?: string;
    size?: number;
    market?: string;
};
