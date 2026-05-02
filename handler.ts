// © 2026 Oscar Knap - Alle rechten voorbehouden

import type z from "zod";
import type { LrResponse, lrResponseObject, httpMethod } from "./response";
import type { afterParseRequest, lrRequest, matchRequest, methodsDefinitionToMethods, pathDefinitionToParams, pathDefinitionToType } from "./types";

// typescript sometimes converts the Symbol('lrNext') to symbol, so we just convert it to a special object
export const lrNext = Symbol('lrNext') as unknown as 'lrNext' & { __lrNext: symbol };

type pathParts = ({
    type: 'literal';
    value: string;
} | {
    type: 'param';
    name: string;
} | {
    type: 'rest';
})[];

function pathToParts(path: string): pathParts {
    if (!path.startsWith('/')) {
        throw new Error(`Path must start with /, got ${path}`);
    }

    let parts: pathParts = [];

    for (const stringI in path.slice(1).split('/')) {
        const i = parseInt(stringI);

        const part = path.slice(1).split('/')[i]!;
        const isLast = i === path.slice(1).split('/').length - 1;

        if (part === '*') {
            if (!isLast) {
                throw new Error('* path part must be last');
            }

            if (parts.find(part => part.type === 'rest')) {
                throw new Error('rest part already exists');
            }

            parts.push({
                type: 'rest',
            });
        } else if (part.startsWith(':')) {
            const name = part.slice(1);

            if (parts.find(part => part.type === 'param' && part.name === name)) {
                throw new Error(`Param ${name} already exists`);
            }

            if (name.trim().length === 0) {
                throw new Error('Param name cannot be empty');
            }

            if (name === 'rest') {
                throw new Error('Param name cannot be rest');
            }

            if (name === '__proto__') {
                throw new Error('Param name cannot be __proto__');
            }

            parts.push({
                type: 'param',
                name,
            });
        } else {
            parts.push({
                type: 'literal',
                value: part,
            });
        }
    }

    return parts;
}

function parseParams(pathPrefix: string, path: string, reqPath: string): Record<string, string> {
    if (!reqPath.startsWith(pathPrefix)) {
        throw new Error(`parseParams got reqPath ${reqPath} that doesn't start with pathPrefix ${pathPrefix}`);
    }

    const restPath = reqPath.slice(pathPrefix.length);

    if (!restPath.startsWith('/')) {
        throw new Error(`parseParams has restPath ${restPath} that doesn't start with /`);
    }

    const parts = pathToParts(path);

    const restPathParts = restPath.slice(1).split('/');

    if (restPathParts.length < parts.length) {
        throw new Error(`parseParams has restPathParts ${restPathParts} that are less than parts ${parts}`);
    }

    let params: Record<string, string> = Object.create(null);

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const restPart = restPathParts[i]!;

        if (part.type === 'param') {
            if (part.name === '__proto__') {
                throw new Error('Param name cannot be __proto__');
            }

            params[part.name] = restPart;
        } else if (part.type === 'rest') {
            params['*'] = restPathParts.slice(i).join('/');
        }
    }

    return params;
}

type lrHandlerReturn = LrResponse<lrResponseObject> | typeof lrNext;

export type lrHandlerCallback<
    method extends httpMethod,
    path extends `/${string}`,
    params extends Record<string, any>, // any, because it can be transformed with zod
    query extends Record<string, any>, // any, because it can be transformed with zod
    body extends any
> =
    (req: afterParseRequest<method, path, params, query, body>)
        => (lrHandlerReturn | Promise<lrHandlerReturn>);

export type generalValidations<
    methods extends '*' | httpMethod[],
    path extends string,
> = null | {
    body?: z.ZodType;
    query?: z.ZodType<unknown, Record<string, string>>;
    params?: z.ZodType<unknown, pathDefinitionToParams<path>>;
    failResponse: (
        req: lrRequest<methodsDefinitionToMethods<methods>, pathDefinitionToType<path>>,
        errors: {
            bodyError: z.ZodError | null;
            queryError: z.ZodError | null;
            paramsError: z.ZodError | null;
        }
    ) => LrResponse<lrResponseObject> | Promise<LrResponse<lrResponseObject>>;
};

export class LrHandler<
    methods extends '*' | httpMethod[],
    path extends string,
    validations extends generalValidations<methods, path>,
    callback extends lrHandlerCallback<
        methodsDefinitionToMethods<methods>,
        pathDefinitionToType<path>,
        validations extends { params: any } ? z.output<validations['params']> : pathDefinitionToParams<path>,
        validations extends { query: any } ? z.output<validations['query']> : Record<string, string>,
        validations extends { body: any } ? z.output<validations['body']> : unknown
    >
> {
    methods: methods;
    path: path;
    validations: validations;
    callback: callback;

    constructor(methods: methods, path: path, validations: validations, callback: callback) {
        this.methods = methods;
        this.path = path;
        this.validations = validations;
        this.callback = callback;
    }

    match<testMethod extends httpMethod, testPath extends `/${string}`>(method: testMethod, path: testPath):
        matchRequest<methods, path, testMethod, testPath> {
        const methodMatches = this.methods === '*' || this.methods.includes(method);

        if (!methodMatches) return false as matchRequest<methods, path, testMethod, testPath>;

        if (!path.startsWith('/')) {
            throw new Error(`Request path must start with /, got ${path}`);
        }

        const reqPathSplit = path.slice(1).split('/');

        const pathParts = pathToParts(this.path);

        if (reqPathSplit.length < pathParts.length) return false as matchRequest<methods, path, testMethod, testPath>;

        let hasRest = false;

        for (const stringI in pathParts) {
            const i = parseInt(stringI);

            const pathPart = pathParts[i]!;
            const reqPart = reqPathSplit[i];

            if (pathPart.type === 'literal' && pathPart.value !== reqPart) return false as matchRequest<methods, path, testMethod, testPath>;
            if (pathPart.type === 'param') continue;
            if (pathPart.type === 'rest') {
                hasRest = true;
                break;
            }
        }

        if (reqPathSplit.length > pathParts.length) {
            if (hasRest) {
                return true as matchRequest<methods, path, testMethod, testPath>;
            } else {
                return false as matchRequest<methods, path, testMethod, testPath>;
            }
        }

        return true as matchRequest<methods, path, testMethod, testPath>;
    }

    async execute(
        pathPrefix: string,
        req: lrRequest<methodsDefinitionToMethods<methods>, pathDefinitionToType<path>>
    ): Promise<
        Awaited<ReturnType<callback>> // awaited and promise, because callback doesn't have to be async
        | (
            validations extends { failResponse: (...args: any[]) => infer returnFailResponse }
            ? (
                Awaited<returnFailResponse>
            ) : never
        )
    > {
        let newReq = { ...req } as any;

        newReq.params = parseParams(pathPrefix, this.path, newReq.path);

        if (this.validations) {
            let bodyError = null;
            let queryError = null;
            let paramsError = null;

            if (this.validations.body) {
                const bodyResult = await this.validations.body.safeParseAsync(newReq.body);

                if (!bodyResult.success) {
                    bodyError = bodyResult.error;
                } else {
                    newReq.body = bodyResult.data;
                }
            }

            if (this.validations.query) {
                const queryResult = await this.validations.query.safeParseAsync(newReq.query);

                if (!queryResult.success) {
                    queryError = queryResult.error;
                } else {
                    newReq.query = queryResult.data;
                }
            }

            if (this.validations.params) {
                const paramsResult = await this.validations.params.safeParseAsync(newReq.params);

                if (!paramsResult.success) {
                    paramsError = paramsResult.error;
                } else {
                    newReq.params = paramsResult.data;
                }
            }

            if (bodyError || queryError || paramsError) {
                const response = await this.validations.failResponse(req, { bodyError, queryError, paramsError });

                return response as any;
            }
        }

        const response = await this.callback(newReq);

        return response as any;
    }
};

export function lrHandler<
    methods extends '*' | httpMethod[],
    path extends `/${string}`,
    validations extends generalValidations<methods, path>,
    callback extends lrHandlerCallback<
        methodsDefinitionToMethods<methods>,
        pathDefinitionToType<path>,
        validations extends { params: any } ? z.output<validations['params']> : pathDefinitionToParams<path>,
        validations extends { query: any } ? z.output<validations['query']> : Record<string, string>,
        validations extends { body: any } ? z.output<validations['body']> : unknown
    >
>(methods: methods, path: path, validations: validations, callback: callback): LrHandler<methods, path, validations, callback> {
    return new LrHandler(methods, path, validations, callback);
}