"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTx = exports.signTx = exports.invoke = exports.NotImplementedError = void 0;
const SorobanClient = require("soroban-client");
const soroban_client_1 = require("soroban-client");
/**
 * Get account details from the Soroban network for the publicKey currently
 * selected in Freighter. If not connected to Freighter, return null.
 */
async function getAccount(wallet, server) {
    if (!(await wallet.isConnected()) || !(await wallet.isAllowed())) {
        return null;
    }
    const { publicKey } = await wallet.getUserInfo();
    if (!publicKey) {
        return null;
    }
    return await server.getAccount(publicKey);
}
class NotImplementedError extends Error {
}
exports.NotImplementedError = NotImplementedError;
// defined this way so typeahead shows full union, not named alias
let someRpcResponse;
async function invoke({ method, args = [], fee = 100, responseType, parseResultXdr, secondsToWait = 10, rpcUrl, networkPassphrase, contractId, wallet, }) {
    wallet = wallet ?? (await Promise.resolve().then(() => require("@stellar/freighter-api")));
    let parse = parseResultXdr;
    const server = new SorobanClient.Server(rpcUrl, {
        allowHttp: rpcUrl.startsWith("http://"),
    });
    const walletAccount = await getAccount(wallet, server);
    // use a placeholder null account if not yet connected to Freighter so that view calls can still work
    const account = walletAccount ??
        new SorobanClient.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
    const contract = new SorobanClient.Contract(contractId);
    let tx = new SorobanClient.TransactionBuilder(account, {
        fee: fee.toString(10),
        networkPassphrase,
    })
        .setNetworkPassphrase(networkPassphrase)
        .addOperation(contract.call(method, ...args))
        .setTimeout(SorobanClient.TimeoutInfinite)
        .build();
    const simulated = await server.simulateTransaction(tx);
    if (soroban_client_1.SorobanRpc.isSimulationError(simulated)) {
        throw new Error(simulated.error);
    }
    else if (responseType === "simulated") {
        return simulated;
    }
    else if (!simulated.result) {
        throw new Error(`invalid simulation: no result in ${simulated}`);
    }
    let authsCount = simulated.result.auth.length;
    const writeLength = simulated.transactionData.getReadWrite().length;
    const isViewCall = (authsCount === 0) && (writeLength === 0);
    if (isViewCall) {
        if (responseType === "full") {
            return simulated;
        }
        return parseResultXdr(simulated.result.retval);
    }
    if (authsCount > 1) {
        throw new NotImplementedError("Multiple auths not yet supported");
    }
    if (authsCount === 1) {
        // TODO: figure out how to fix with new SorobanClient
        // const auth = SorobanClient.xdr.SorobanAuthorizationEntry.fromXDR(auths![0]!, 'base64')
        // if (auth.addressWithNonce() !== undefined) {
        //   throw new NotImplementedError(
        //     `This transaction needs to be signed by ${auth.addressWithNonce()
        //     }; Not yet supported`
        //   )
        // }
    }
    if (!walletAccount) {
        throw new Error("Not connected to Freighter");
    }
    tx = await signTx(wallet, SorobanClient.assembleTransaction(tx, networkPassphrase, simulated).build(), networkPassphrase);
    const raw = await sendTx(tx, secondsToWait, server);
    if (responseType === "full") {
        return raw;
    }
    // if `sendTx` awaited the inclusion of the tx in the ledger, it used
    // `getTransaction`, which has a `resultXdr` field
    if ("resultXdr" in raw) {
        const getResult = raw;
        if (getResult.status !== soroban_client_1.SorobanRpc.GetTransactionStatus.SUCCESS) {
            console.error('Transaction submission failed! Returning full RPC response.');
            return raw;
        }
        return parse(raw.resultXdr.result().toXDR("base64"));
    }
    // otherwise, it returned the result of `sendTransaction`
    if ("errorResultXdr" in raw) {
        const sendResult = raw;
        return parse(sendResult.errorResultXdr);
    }
    // if neither of these are present, something went wrong
    console.error("Don't know how to parse result! Returning full RPC response.");
    return raw;
}
exports.invoke = invoke;
/**
 * Sign a transaction with Freighter and return the fully-reconstructed
 * transaction ready to send with {@link sendTx}.
 *
 * If you need to construct a transaction yourself rather than using `invoke`
 * or one of the exported contract methods, you may want to use this function
 * to sign the transaction with Freighter.
 */
async function signTx(wallet, tx, networkPassphrase) {
    const signed = await wallet.signTransaction(tx.toXDR(), {
        networkPassphrase,
    });
    return SorobanClient.TransactionBuilder.fromXDR(signed, networkPassphrase);
}
exports.signTx = signTx;
/**
 * Send a transaction to the Soroban network.
 *
 * Wait `secondsToWait` seconds for the transaction to complete (default: 10).
 *
 * If you need to construct or sign a transaction yourself rather than using
 * `invoke` or one of the exported contract methods, you may want to use this
 * function for its timeout/`secondsToWait` logic, rather than implementing
 * your own.
 */
async function sendTx(tx, secondsToWait, server) {
    const sendTransactionResponse = await server.sendTransaction(tx);
    if (sendTransactionResponse.status !== "PENDING" || secondsToWait === 0) {
        return sendTransactionResponse;
    }
    let getTransactionResponse = await server.getTransaction(sendTransactionResponse.hash);
    const waitUntil = new Date(Date.now() + secondsToWait * 1000).valueOf();
    let waitTime = 1000;
    let exponentialFactor = 1.5;
    while (Date.now() < waitUntil &&
        getTransactionResponse.status === soroban_client_1.SorobanRpc.GetTransactionStatus.NOT_FOUND) {
        // Wait a beat
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        /// Exponential backoff
        waitTime = waitTime * exponentialFactor;
        // See if the transaction is complete
        getTransactionResponse = await server.getTransaction(sendTransactionResponse.hash);
    }
    if (getTransactionResponse.status === soroban_client_1.SorobanRpc.GetTransactionStatus.NOT_FOUND) {
        console.error(`Waited ${secondsToWait} seconds for transaction to complete, but it did not. ` +
            `Returning anyway. Check the transaction status manually. ` +
            `Info: ${JSON.stringify(sendTransactionResponse, null, 2)}`);
    }
    return getTransactionResponse;
}
exports.sendTx = sendTx;
