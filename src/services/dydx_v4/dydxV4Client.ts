import {
    BECH32_PREFIX,
    CompositeClient,
    Network,
    SubaccountClient,
    ValidatorConfig,
    LocalWallet,
    OrderExecution,
    OrderSide,
    OrderTimeInForce,
    OrderType,
    IndexerConfig
} from '@dydxprotocol/v4-client-js';
import { dydxV4OrderParams, AlertObject, PlaceOrderResult } from '../../types';

const MAX_CONNECTION_RETRIES = 3;

export class DydxV4Client {
    private static client: CompositeClient | null = null;
    private static subaccount: SubaccountClient | null = null;

    async placeOrder(alertMessage: AlertObject): Promise<PlaceOrderResult> {
        const orderParams = this.buildOrderParams(alertMessage);
        const sideLabel = orderParams.side === OrderSide.BUY ? 'Buy' : 'Sell';

        // Phase 1: Retry connection up to MAX_CONNECTION_RETRIES times
        let client: CompositeClient;
        let subaccount: SubaccountClient;
        let retries = 0;

        for (let attempt = 0; attempt <= MAX_CONNECTION_RETRIES; attempt++) {
            try {
                const result = await this.getClient();
                client = result.client;
                subaccount = result.subaccount;
                retries = attempt;
                break;
            } catch (error) {
                retries = attempt;
                if (attempt >= MAX_CONNECTION_RETRIES) {
                    console.error('Connection failed after', MAX_CONNECTION_RETRIES, 'retries:', error);
                    return {
                        success: false,
                        retries: MAX_CONNECTION_RETRIES,
                        errorType: 'connection',
                        side: sideLabel,
                        size: orderParams.size,
                        market: orderParams.market,
                    };
                }
                console.error('Connection attempt', attempt + 1, 'failed, retrying...', error);
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }

        // Phase 2: Place order — NO retry to prevent duplicate orders
        const market = orderParams.market;
        const type = OrderType.MARKET;
        const side = orderParams.side;
        const timeInForce = OrderTimeInForce.GTT;
        const execution = OrderExecution.DEFAULT;
        const slippagePercentage = 0.05;
        const price =
            side === OrderSide.BUY
                ? orderParams.price * (1 + slippagePercentage)
                : orderParams.price * (1 - slippagePercentage);
        const size = orderParams.size;
        const clientId = this.generateRandomInt32();
        const postOnly = false;
        const reduceOnly = false;
        const triggerPrice = null;

        try {
            const tx = await client!.placeOrder(
                subaccount!,
                market,
                type,
                side,
                price,
                size,
                clientId,
                timeInForce,
                120000,
                execution,
                postOnly,
                reduceOnly,
                triggerPrice
            );
            console.log('Order placed. Client ID:', clientId, 'TX:', tx);
            return {
                success: true,
                retries,
                side: sideLabel,
                size: orderParams.size,
                market: orderParams.market,
            };
        } catch (error) {
            console.error('Order creation failed (no retry to prevent duplicates):', error);
            DydxV4Client.client = null;
            DydxV4Client.subaccount = null;
            return {
                success: false,
                retries,
                errorType: 'order',
                side: sideLabel,
                size: orderParams.size,
                market: orderParams.market,
            };
        }
    }
