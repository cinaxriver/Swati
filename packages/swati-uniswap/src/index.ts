export async function swap(tokenIn: string, tokenOut: string, amount: string): Promise<any> {
    console.log(`[uniswap] Swapping ${amount} ${tokenIn} for ${tokenOut}...`);
    return { txHash: "0xabc123" };
}
