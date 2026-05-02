// AI

declare module "bun:test" {
    export const afterAll: (callback: () => void | Promise<void>) => void;
    export const describe: (name: string, callback: () => void) => void;
    export const test: (name: string, callback: () => void | Promise<void>) => void;
    export const expect: any;
}
