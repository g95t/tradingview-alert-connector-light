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
    private static initializing: Promise<{ client: CompositeClient; subaccount: SubaccountClient }> | null = null;

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
                retries = attempt; // 0 = first try, 1 = first retry, etc.
                break;
            } catch (error) {
                retries = attempt;
                if (attempt >= MAX_CONNECTION_RETRIES) {
                    // All connection attempts exhausted
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
                // Wait before retry (1s, 2s, 3s)
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
                120000, // GTT 2 minutes
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
            // Order execution failed — do NOT retry (could create duplicate orders)
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

    private buildOrderParams(alertMessage: AlertObject): dydxV4OrderParams {
        const orderSide =
            alertMessage.order === 'buy' ? OrderSide.BUY : OrderSide.SELL;
        const market = alertMessage.market.replace(/_/g, '-');

        // If no price provided, use extreme price for immediate fill
        let price: number;
        if (alertMessage.price) {
            price = Number(alertMessage.price);
        } else {
            price = orderSide === OrderSide.BUY ? 10000000 : 1;
        }

        const orderParams: dydxV4OrderParams = {
            market,
            side: orderSide,
            size: Number(alertMessage.size),
            price
        };
        console.log('orderParams for dydx v4', orderParams);
        return orderParams;
    }

    private async getClient() {
        if (DydxV4Client.client && DydxV4Client.subaccount) {
            return { client: DydxV4Client.client, subaccount: DydxV4Client.subaccount };
        }
        if (DydxV4Client.initializing) {
            return DydxV4Client.initializing;
        }
        DydxV4Client.initializing = this.initializeClient();
        try {
            const result = await DydxV4Client.initializing;
            return result;
        } finally {
            DydxV4Client.initializing = null;
        }
    }

    private async initializeClient() {
        const validatorConfig = new ValidatorConfig(
            'https://dydx-ops-rpc.kingnodes.com',
            'dydx-mainnet-1',
            {
                CHAINTOKEN_DENOM: 'adydx',
                CHAINTOKEN_DECIMALS: 18,
                USDC_DENOM: 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5',
                USDC_GAS_DENOM: 'uusdc',
                USDC_DECIMALS: 6
            }
        );
        const network =
            process.env.NODE_ENV === 'production'
                ? new Network('mainnet', this.getIndexerConfig(), validatorConfig)
                : Network.testnet();

        let client;
        try {
            client = await CompositeClient.connect(network);
        } catch (e) {
            console.error(e);
            throw new Error('Failed to connect to dYdX v4');
        }

        const localWallet = await this.generateLocalWallet();
        const subaccount = new SubaccountClient(localWallet, 0);

        DydxV4Client.client = client;
        DydxV4Client.subaccount = subaccount;

        return { client, subaccount };
    }

    private async generateLocalWallet() {
        if (!process.env.DYDX_V4_MNEMONIC) {
            throw new Error('DYDX_V4_MNEMONIC is not set');
        }
        const localWallet = await LocalWallet.fromMnemonic(
            process.env.DYDX_V4_MNEMONIC,
            BECH32_PREFIX
        );
        console.log('dYdX v4 Address:', localWallet.address);
        return localWallet;
    }

    private getIndexerConfig() {
        return new IndexerConfig(
            'https://indexer.dydx.trade',
            'wss://indexer.dydx.trade/v4/w'
        );
    }

    private generateRandomInt32(): number {
        return Math.floor(Math.random() * 2147483648);
    }
}
