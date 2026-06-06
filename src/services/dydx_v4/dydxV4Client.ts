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
import { dydxV4OrderParams, AlertObject } from '../../types';

export class DydxV4Client {
    private static client: CompositeClient | null = null;
    private static subaccount: SubaccountClient | null = null;

    async placeOrder(alertMessage: AlertObject) {
        const orderParams = this.buildOrderParams(alertMessage);
        const { client, subaccount } = await this.getClient();

        const market = orderParams.market;
        const type = OrderType.MARKET;
        const side = orderParams.side;
        const timeInForce = OrderTimeInForce.GTT;
        const execution = OrderExecution.DEFAULT;
        const slippagePercentage = 0.05;
        const price =
            side == OrderSide.BUY
                ? orderParams.price * (1 + slippagePercentage)
                : orderParams.price * (1 - slippagePercentage);
        const size = orderParams.size;
        const clientId = this.generateRandomInt32();
        const postOnly = false;
        const reduceOnly = false;
        const triggerPrice = null;

        try {
            const tx = await client.placeOrder(
                subaccount,
                market,
                type,
                side,
                price,
                size,
                clientId,
                timeInForce,
                120000, // GTT 2 minuti
                execution,
                postOnly,
                reduceOnly,
                triggerPrice
            );
            console.log('Order placed. Client ID:', clientId, 'TX:', tx);
            return { side: orderParams.side, size: orderParams.size, orderId: String(clientId) };
        } catch (error) {
            console.error('Order creation failed (no retry to prevent duplicates):', error);
            DydxV4Client.client = null;
            DydxV4Client.subaccount = null;
            return null;
        }
    }

    private buildOrderParams(alertMessage: AlertObject): dydxV4OrderParams {
        const orderSide =
            alertMessage.order == 'buy' ? OrderSide.BUY : OrderSide.SELL;
        const market = alertMessage.market.replace(/_/g, '-');
        const orderSize = alertMessage.size;

        const orderParams: dydxV4OrderParams = {
            market,
            side: orderSide,
            size: Number(orderSize),
            price: Number(alertMessage.price)
        };
        console.log('orderParams for dydx v4', orderParams);
        return orderParams;
    }

    private async getClient() {
        if (DydxV4Client.client && DydxV4Client.subaccount) {
            return { client: DydxV4Client.client, subaccount: DydxV4Client.subaccount };
        }

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
            process.env.NODE_ENV == 'production'
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
