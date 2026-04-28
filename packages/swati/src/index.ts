export type Role = string;

export interface Choreography<Input = any, Output = any> {
    id: string;
    roles: Role[];
    flow: (c: Conductor<Input, Output>) => Promise<Output>;
}

export interface Conductor<Input = any, Output = any> {
    input: Input;
    // Allow arbitrary roles like c.researcher, c.executor
    [role: string]: any;
    send: (payload: any, from: Role, to: Role) => void;
    choose: (options: string[], payload?: any) => Promise<string>;
    recurse: (newInput: Input) => Promise<Output>;
}

export function choreography<I, O>(
    id: string,
    def: { roles: Role[], flow: (c: Conductor<I, O>) => Promise<O> }
): Choreography<I, O> {
    return {
        id,
        roles: def.roles,
        flow: def.flow
    };
}
