// © 2026 Oscar Knap - Alle rechten voorbehouden

import type z from "zod";
import { type LrResponse, type lrResponseObject, type httpMethod, httpMethods } from "./response";
import type { lrHandlerRequest, lrRequest, matchRequest, methodsDefinitionToMethods, pathDefinitionToParams, pathDefinitionToType } from "./types";
import type { file } from "./node";

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

            if (name === '__proto__') throw new Error('Param name cannot be __proto__');
            if (name === 'prototype') throw new Error('Param name cannot be prototype');
            if (name === 'constructor') throw new Error('Param name cannot be constructor');


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

export function match<
    methods extends '*' | httpMethod | readonly httpMethod[],
    path extends string,
    testMethod extends httpMethod,
    testPath extends `/${string}`
>(
    methods: methods,
    path: path,
    testMethod: testMethod,
    testPath: testPath
): matchRequest<methods, path, testMethod, testPath> {
    let methodMatches = false;
    if (methods === '*') methodMatches = true;
    else if (typeof methods === 'string') methodMatches = (methods as string) === testMethod;
    else methodMatches = methods.includes(testMethod);

    if (!methodMatches) return false as matchRequest<methods, path, testMethod, testPath>;

    if (!testPath.startsWith('/')) {
        throw new Error(`Request path must start with /, got ${testPath}`);
    }

    const reqPathSplit = testPath.slice(1).split('/');

    const pathParts = pathToParts(path);

    // +1 because /abc should match /abc/*
    if ((reqPathSplit.length + 1) < pathParts.length) return false as matchRequest<methods, path, testMethod, testPath>;

    let hasRest = false;

    for (const stringI in pathParts) {
        const i = parseInt(stringI);

        const pathPart = pathParts[i]!;
        const reqPart = reqPathSplit[i];

        if (pathPart.type === 'literal') {
            if (reqPart === undefined) return false as matchRequest<methods, path, testMethod, testPath>;
            if (pathPart.value !== reqPart) return false as matchRequest<methods, path, testMethod, testPath>;
        }
        if (pathPart.type === 'param') {
            if (reqPart === undefined) return false as matchRequest<methods, path, testMethod, testPath>;
            if (reqPart === '') return false as matchRequest<methods, path, testMethod, testPath>;
            continue;
        }
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

function parseParams(pathPrefix: string, path: string, reqPath: string): Record<string, string> {
    if (!reqPath.startsWith(pathPrefix)) {
        throw new Error(`parseParams got reqPath ${reqPath} that doesn't start with pathPrefix ${pathPrefix}`);
    }

    let restPath = reqPath.slice(pathPrefix.length);

    if (restPath === '') restPath = '/';

    if (!restPath.startsWith('/')) {
        throw new Error(`parseParams has restPath ${restPath} that doesn't start with /`);
    }

    const parts = pathToParts(path);

    let restPathParts = restPath.slice(1).split('/');

    // because /abc should match /abc/*
    if (
        parts[parts.length - 1]?.type === 'rest' &&
        restPathParts.length + 1 === parts.length
    ) {
        restPathParts.push('');
    }

    if (restPathParts.length < parts.length) {
        throw new Error(`parseParams has restPathParts ${restPathParts} that are less than parts ${parts}`);
    }

    let params: Record<string, string> = Object.create(null);

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const restPart = restPathParts[i];

        if (part.type === 'param') {
            if (part.name === '__proto__') throw new Error('Param name cannot be __proto__');
            if (part.name === 'prototype') throw new Error('Param name cannot be prototype');
            if (part.name === 'constructor') throw new Error('Param name cannot be constructor');

            if (!restPart) throw new Error(`Param ${part.name} is missing`);

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
    files extends Record<string, any>, // any, because it can be transformed with zod
    body extends any
> =
    (req: lrHandlerRequest<method, path, params, query, files, body>)
        => (lrHandlerReturn | Promise<lrHandlerReturn>);

export type generalValidations<
    methods extends '*' | httpMethod | readonly httpMethod[],
    path extends string,
> = null | {
    body?: z.ZodType;
    query?: z.ZodType<unknown, Record<string, string>>;
    params?: z.ZodType<unknown, pathDefinitionToParams<path>>;
    files?: z.ZodType<unknown, Record<string, file>>;
    failResponse: (
        errors: {
            bodyError: z.ZodError | null;
            filesError: z.ZodError | null;
            queryError: z.ZodError | null;
            paramsError: z.ZodError | null;
        },
        req: lrRequest<methodsDefinitionToMethods<methods>, pathDefinitionToType<path>>
    ) => LrResponse<lrResponseObject> | Promise<LrResponse<lrResponseObject>>;
};

export type lrGeneralLrHandler = LrHandler<
    '*' | httpMethod | readonly httpMethod[],
    `/${string}`,
    generalValidations<'*' | httpMethod | readonly httpMethod[], `/${string}`>,
    lrHandlerCallback<httpMethod, `/${string}`, Record<string, any>, Record<string, any>, Record<string, any>, unknown>
>;

export class LrHandler<
    methods extends '*' | httpMethod | readonly httpMethod[],
    path extends string,
    validations extends generalValidations<methods, path>,
    callback extends lrHandlerCallback<
        methodsDefinitionToMethods<methods>,
        pathDefinitionToType<path>,
        validations extends { params: any } ? z.output<validations['params']> : pathDefinitionToParams<path>,
        validations extends { query: any } ? z.output<validations['query']> : Record<string, string>,
        validations extends { files: any } ? z.output<validations['files']> : Record<string, file>,
        validations extends { body: any } ? z.output<validations['body']> : unknown
    >
> {
    methods: methods;
    path: path;
    validations: validations;
    callback: callback;

    constructor(methods: methods, path: path, validations: validations, callback: callback) {

        if (methods === '*') { }
        else if (Array.isArray(methods) && methods.every(method => httpMethods.includes(method))) { }
        else if (typeof methods === 'string' && httpMethods.includes(methods)) { }
        else {
            throw new Error(`Invalid methods: ${methods}`);
        }

        // to assert path is valid
        pathToParts(path);

        if (validations !== null) {
            if (typeof validations !== 'object') {
                throw new Error(`Invalid validations: ${validations}`);
            }

            if (typeof validations.failResponse !== 'function') {
                throw new Error(`Invalid validations.failResponse: ${validations.failResponse}`);
            }
        }

        if (typeof callback !== 'function') {
            throw new Error(`Invalid callback: ${callback}`);
        }

        this.methods = methods;
        this.path = path;
        this.validations = validations;
        this.callback = callback;
    }

    match<testMethod extends httpMethod, testPath extends `/${string}`>(method: testMethod, path: testPath):
        matchRequest<methods, path, testMethod, testPath> {
        return match(this.methods, this.path, method, path);
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
            let filesError = null;
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

            if (this.validations.files) {
                const filesResult = await this.validations.files.safeParseAsync(newReq.files);

                if (!filesResult.success) {
                    filesError = filesResult.error;
                } else {
                    newReq.files = filesResult.data;
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

            if (bodyError || filesError || queryError || paramsError) {
                const response = await this.validations.failResponse({ bodyError, filesError, queryError, paramsError }, req);

                return response as any;
            }
        }

        const response = await this.callback(newReq);

        return response as any;
    }
};

export function lrHandler<
    methods extends '*' | httpMethod | readonly httpMethod[],
    path extends `/${string}`,
    validations extends generalValidations<methods, path>,
    callback extends lrHandlerCallback<
        methodsDefinitionToMethods<methods>,
        pathDefinitionToType<path>,
        validations extends { params: any } ? z.output<validations['params']> : pathDefinitionToParams<path>,
        validations extends { query: any } ? z.output<validations['query']> : Record<string, string>,
        validations extends { files: any } ? z.output<validations['files']> : Record<string, file>,
        validations extends { body: any } ? z.output<validations['body']> : unknown
    >
>(methods: methods, path: path, validations: validations, callback: callback): LrHandler<methods, path, validations, callback> {
    return new LrHandler(methods, path, validations, callback);
}
