export interface AxlMessage {
    payload: any;
    from: string;
    to: string;
}

export async function send(peer: string, msg: AxlMessage): Promise<void> {
    console.log(`[axl] Sending message to peer ${peer}:`, msg);
}

export async function* recv(): AsyncGenerator<AxlMessage> {
    console.log(`[axl] Listening for incoming messages...`);
    // Stub implementation: wait indefinitely
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}
