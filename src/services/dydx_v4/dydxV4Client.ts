import {
    BECH32_PREFIX,
    CompositeClient,
    Network,
    SubaccountInfo,
    ValidatorConfig,
    LocalWallet,
    OrderExecution,
    OrderSide,
    OrderTimeInForce,
    OrderType,
    IndexerConfig
} from '@dydxprotocol/v4-client-js';
import Long from 'long';
import { dydxV4OrderParams, AlertObject, PlaceOrderResult } from '../../types';

const MAX_CONNECTION_RETRIES = 3;
const CONNECTION_TIMEOUT_MS = 30000;

export class DydxV4Client {
    private static client: CompositeClient | null = null;
    private static subaccount: SubaccountInfo | null = null;
    private static initializing: Promise<{ client: CompositeClient; subaccount: SubaccountInfo }> | null = null;
    // Fix problema 1: store private key for reconnection after process.env deletion
    private static storedPrivateKey: string | null = null;

    async placeOrder(alertMessage: AlertObject): Promise<PlaceOrderResult> {
        const orderParams = this.buildOrderParams(alertMessage);
        const sideLabel = orderParams.side === OrderSide.BUY ? 'Buy' : 'Sell';

        // Phase 1: Retry connection up to MAX_CONNECTION_RETRIES times
        let client: CompositeClient;
        let subaccount: SubaccountInfo;
        let retries = 0;

        for (let attempt = 0; attempt <= MAX_CONNECTION_RETRIES; attempt++) {
            try {
                // Fix problema 7: timeout on connection to prevent infinite hang
                const result = await this.getClientWithTimeout(CONNECTION_TIMEOUT_MS);
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

    private buildOrderParams(alertMessage: AlertObject): dydxV4OrderParams {
        const orderSide =
            alertMessage.order === 'buy' ? OrderSide.BUY : OrderSide.SELL;
        const market = alertMessage.market.replace(/_/g, '-');

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

    // Fix problema 7: wrapper with timeout to prevent infinite hang
    private async getClientWithTimeout(timeoutMs: number): Promise<{ client: CompositeClient; subaccount: SubaccountInfo }> {
        return Promise.race([
            this.getClient(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
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
        const subaccount = SubaccountInfo.forPermissionedWallet(
            localWallet,
            process.env.DYDX_ADDRESS!,
            0,
            [Long.fromString(process.env.DYDX_AUTHENTICATOR_ID!)]
        );

        DydxV4Client.client = client;
        DydxV4Client.subaccount = subaccount;

        return { client, subaccount };
    }

    private async generateLocalWallet() {
        // Fix problema 1: use stored key if available, otherwise read from env
        const privateKey = DydxV4Client.storedPrivateKey || process.env.DYDX_API_PRIVATE_KEY;
        if (!privateKey) {
            throw new Error('DYDX_API_PRIVATE_KEY is not set');
        }
        // Store for reconnection before deleting from process.env
        DydxV4Client.storedPrivateKey = privateKey;

        const localWallet = await LocalWallet.fromPrivateKey(
            privateKey,
            BECH32_PREFIX
        );
        console.log('dYdX v4 API Key Address:', localWallet.address);
        delete process.env.DYDX_API_PRIVATE_KEY;
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
