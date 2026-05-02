// © 2026 Oscar Knap - Alle rechten voorbehouden

export type { lrResponseObject } from "./response";
export { LrResponse, lrResponse } from "./response";

import { LrResponse } from "./response";
import { sendNodeResponse, transformNodeRequest } from "./node";

import type { httpMethod, matchRequest, pathDefinitionToType, pathDefinitionToParams, methodsDefinitionToMethods, recursiveSimplify, simplify } from "./types";
import type { lrResponseObject, responseCookieOptions, responseWithCookies, responseWithHeaders } from "./response";

// import type { z } from 'zod';
// todo: only type import and dev dep
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from "node:http";

// typescript sometimes converts the Symbol('lrNext') to symbol, so we just convert it to a special object
export const lrNext = Symbol('lrNext') as unknown as 'lrNext' & { __lrNext: symbol };

type afterParseRequest<
    method extends httpMethod,
    path extends `/${string}`,
    params extends Record<string, any>, // any, because it can be transformed with zod
    query extends Record<string, any>, // any, because it can be transformed with zod
    body
> = {
    method: method;
    path: path;
    params: params;
    query: query;
    body: body;
    data: object;
    ip: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
};

export type lrRequest<
    method extends httpMethod,
    path extends `/${string}`,
> = {
    method: method;
    path: path;
    params: null; // null because there is no path definition
    query: Record<string, string>; // not generic, because this is before zod parsing
    body: unknown; // not generic, because this is before zod parsing
    data: object;
    ip: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
};

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

            parts.push({
                type: 'rest',
            });
        } else if (part.startsWith(':')) {
            parts.push({
                type: 'param',
                name: part.slice(1),
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
            params[part.name] = restPart;
        } else if (part.type === 'rest') {
            params['*'] = restPathParts.slice(i).join('/');
        }
    }

    return params;
}

type lrHandlerReturn = LrResponse<lrResponseObject> | typeof lrNext;

type lrHandlerCallback<
    method extends httpMethod,
    path extends `/${string}`,
    params extends Record<string, any>, // any, because it can be transformed with zod
    query extends Record<string, any>, // any, because it can be transformed with zod
    body extends any
> =
    (req: afterParseRequest<method, path, params, query, body>)
        => (lrHandlerReturn | Promise<lrHandlerReturn>);

type generalValidations<
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

class LrHandler<
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

type generalRouterMatch = {
    type: 'router';
    router: LrRouter<'' | `/${string}`, generalHandlerOrRouter[]>;
    matches: generalRouterMatchReturn[];
};

type generalHandlerMatch = {
    type: 'handler';
    handler: LrHandler<
        httpMethod[] | '*',
        `/${string}`,
        generalValidations<httpMethod[] | '*', `/${string}`>,
        lrHandlerCallback<httpMethod, `/${string}`, Record<string, any>, Record<string, any>, unknown>
    >;
};

type generalRouterMatchReturn = generalHandlerMatch | generalRouterMatch;

type routerMatchReturnInternal<
    pathPrefix extends '' | `/${string}`,
    handlers extends any[], // can't be typed better here
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            matchRequest<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, testMethod, testPath> extends true
            ? (
                [
                    {
                        type: 'handler';
                        handler: LrHandler<firstHandlerMethods, firstHandlerPath, firstHandlerValidations, firstHandlerCallback>;
                    },
                    ...routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                ]
            ) : (
                routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
            )
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                routerMatchReturnInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath> extends [...infer firstElements, infer lastElement]
                ? (
                    [
                        {
                            type: 'router';
                            router: LrRouter<firstHandlerPathPrefix, firstHandlerHandlers>;
                            matches: [...firstElements, lastElement];
                        },
                        ...routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ]
                )
                // empty return, so router has no matches
                : [...routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>]
            ) : never
        )
    ) : []; // handlers is empty array

type routerMatchReturn<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    {
        type: 'router';
        router: LrRouter<pathPrefix, handlers>;
        matches: routerMatchReturnInternal<pathPrefix, handlers, testMethod, testPath>;
    };

type generalHandlerOrRouter = LrHandler<any, any, any, any> | LrRouter<any, any>;

class LrRouter<pathPrefix extends '' | `/${string}`, handlers extends generalHandlerOrRouter[]> {
    pathPrefix: pathPrefix;
    handlers: handlers;

    constructor(pathPrefix: pathPrefix, handlers: handlers) {
        this.pathPrefix = pathPrefix;
        this.handlers = handlers;
    }

    match<testMethod extends httpMethod, testPath extends `/${string}`>(method: testMethod, path: testPath):
        routerMatchReturn<pathPrefix, handlers, testMethod, testPath> {

        return this.#matchInternal('', method, path) as routerMatchReturn<pathPrefix, handlers, testMethod, testPath>;
    }

    #matchInternal(previousPathPrefix: string, method: httpMethod, path: `/${string}`): generalRouterMatch {
        const currentPathPrefix = `${previousPathPrefix}${this.pathPrefix}`;

        if (!path.startsWith(currentPathPrefix)) {
            return {
                type: 'router',
                router: this,
                matches: []
            };
        }

        const restPath = path.slice(currentPathPrefix.length);

        if (!restPath.startsWith('/')) {
            return {
                type: 'router',
                router: this,
                matches: []
            };
        }

        let matches: generalRouterMatchReturn[] = [];

        for (const handler of this.handlers) {
            if (handler instanceof LrHandler) {
                const match = handler.match(method, restPath as `/${string}`);

                if (match) {
                    matches.push({
                        type: 'handler',
                        handler
                    });
                }
            } else if (handler instanceof LrRouter) {
                const match = handler.#matchInternal(currentPathPrefix, method, restPath as `/${string}`);

                if (match.matches.length > 0) {
                    matches.push(match);
                }
            }
        }

        return {
            type: 'router',
            router: this,
            matches
        };
    }

    async execute<testMethod extends httpMethod, testPath extends `/${string}`>(req: lrRequest<testMethod, testPath>): Promise<lrRouterReturn<this, testMethod, testPath>> {
        const match = this.match(req.method, req.path);

        const response = await this.#executeInternal('', match, req);

        if (response === lrNext) {
            return lrNext as lrRouterReturn<this, testMethod, testPath>;
        }

        if (!(response instanceof LrResponse)) {
            throw new Error(`handler must return LrResponse, got typeof ${typeof response}`);
        }

        return response as lrRouterReturn<this, testMethod, testPath>;
    }

    async #executeInternal(
        currentPathPrefix: string,
        match: generalRouterMatchReturn,
        req: lrRequest<httpMethod, `/${string}`>
    ): Promise<LrResponse<lrResponseObject> | typeof lrNext> {
        if (match.type === 'handler') {
            const response = await match.handler.execute(currentPathPrefix, req);

            if (response === lrNext) {
                return lrNext;
            }

            if (!(response instanceof LrResponse)) {
                throw new Error(`handler (${Array.isArray(match.handler.methods) ? match.handler.methods.join(', ') : match.handler.methods} ${match.handler.path}) must return LrResponse or lrNext, got typeof ${typeof response}`);
            }

            return response;
        } else if (match.type === 'router') {
            currentPathPrefix = `${currentPathPrefix}${match.router.pathPrefix}`;

            for (const innerMatch of match.matches) {
                const response = await this.#executeInternal(currentPathPrefix, innerMatch, req);

                if (response === lrNext) {
                    continue;
                }

                if (!(response instanceof LrResponse)) {
                    throw new Error(`handler must return LrResponse or lrNext, got typeof ${typeof response}`);
                }

                return response;
            }
        }

        return lrNext;
    }
};

type canRouterCallNext<
    pathPrefix extends '' | `/${string}`,
    handlers extends any[], // can't be typed better here
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            matchRequest<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, testMethod, testPath> extends true
            ? (
                (typeof lrNext) extends Awaited<ReturnType<firstHandlerCallback>>
                ? canRouterCallNext<pathPrefix, restHandlers, testMethod, testPath>
                : false
            ) : (
                canRouterCallNext<pathPrefix, restHandlers, testMethod, testPath>
            )
        ) : (
            firstHandler extends LrRouter<infer lastHandlerPathPrefix, infer lastHandlerHandlers>
            ? (
                canRouterCallNext<`${pathPrefix}${lastHandlerPathPrefix}`, lastHandlerHandlers, testMethod, testPath> extends true
                ? canRouterCallNext<pathPrefix, restHandlers, testMethod, testPath>
                : false
            ) : never // invalid lastHandler
        )
    ) : true; // empty handlers

type routerReturnInternal<
    pathPrefix extends '' | `/${string}`,
    handlers extends any[], // can't be typed better here
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            matchRequest<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, testMethod, testPath> extends true
            ? (
                Exclude<Awaited<ReturnType<firstHandlerCallback>>, typeof lrNext>
                | (
                    firstHandlerValidations extends { failResponse: (...args: any[]) => infer returnFailResponse }
                    ? (
                        Awaited<returnFailResponse>
                    ) : never
                )
                | (
                    (typeof lrNext) extends Awaited<ReturnType<firstHandlerCallback>> ? (
                        routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : never
                )
            )
            : routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                routerReturnInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                | (
                    canRouterCallNext<firstHandlerPathPrefix, firstHandlerHandlers, testMethod, testPath> extends true
                    ? (
                        routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : never
                )
            ) : never
        )
    ) : (
        // no handlers
        never
    );

export type lrRouterReturn<
    router extends LrRouter<'' | `/${string}`, generalHandlerOrRouter[]>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    router extends LrRouter<infer pathPrefix, infer handlers>
    ? (
        routerReturnInternal<pathPrefix, handlers, testMethod, testPath>
        | (
            canRouterCallNext<pathPrefix, handlers, testMethod, testPath> extends true
            ? typeof lrNext
            : never
        )
    ) : never;

type validationsToRequirements<
    validations extends any // can't be typed better here
> =
    (validations extends { body: z.ZodType } ? { body: z.input<validations['body']> } : unknown)
    & (validations extends { query: z.ZodType } ? { query: z.input<validations['query']> } : unknown);

type routerRequirementsInternal<
    pathPrefix extends '' | `/${string}`,
    handlers extends any[], // can't be typed better here
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            matchRequest<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, testMethod, testPath> extends true
            ? (
                validationsToRequirements<firstHandlerValidations>
                & (
                    (typeof lrNext) extends Awaited<ReturnType<firstHandlerCallback>> ? (
                        routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : unknown
                )
            ) : routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                routerRequirementsInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                & (
                    canRouterCallNext<firstHandlerPathPrefix, firstHandlerHandlers, testMethod, testPath> extends true
                    ? (
                        routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : unknown
                )
            ) : never
        )
    ) : (
        // no handlers
        { body: {}, query: {} }
    )
    ;

export type lrRouterRequirements<
    router extends LrRouter<'' | `/${string}`, generalHandlerOrRouter[]>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    router extends LrRouter<infer pathPrefix, infer handlers>
    ? (
        recursiveSimplify<routerRequirementsInternal<pathPrefix, handlers, testMethod, testPath>>
    ) : never;

export function lrRouter<pathPrefix extends '' | `/${string}`, handlers extends generalHandlerOrRouter[]>(pathPrefix: pathPrefix, handlers: handlers): LrRouter<pathPrefix, handlers> {
    return new LrRouter(pathPrefix, handlers);
}

type generalErrorResponseFunction =
    (req: lrRequest<httpMethod, `/${string}`>, error: unknown)
        => LrResponse<lrResponseObject> | Promise<LrResponse<lrResponseObject>>;

type noHandlerResponseFunction =
    (req: lrRequest<httpMethod, `/${string}`>)
        => LrResponse<lrResponseObject> | Promise<LrResponse<lrResponseObject>>;

type generalAddResponseHeaders =
    (req: lrRequest<httpMethod, `/${string}`>, res: LrResponse<lrResponseObject>) => Record<string, string> | Promise<Record<string, string>>;

type generalAddResponseCookies =
    (req: lrRequest<httpMethod, `/${string}`>, res: LrResponse<lrResponseObject>) =>
        Record<
            string,
            { value: string; } & Partial<responseCookieOptions>
        >
        | Promise<
            Record<
                string,
                { value: string; } & Partial<responseCookieOptions>
            >
        >;

class LrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    errorResponse extends LrResponse<lrResponseObject>,
    noHandlerResponse extends noHandlerResponseFunction,
    errorResponseFunction extends generalErrorResponseFunction | undefined,
    addResponseHeaders extends generalAddResponseHeaders | undefined,
    addResponseCookies extends generalAddResponseCookies | undefined
> {
    router: LrRouter<pathPrefix, handlers>;
    errorResponse: errorResponse;
    errorResponseFunction: errorResponseFunction;
    noHandlerResponse: noHandlerResponse;
    addResponseHeaders: addResponseHeaders;
    addResponseCookies: addResponseCookies;

    constructor(router: LrRouter<pathPrefix, handlers>, errorResponse: errorResponse, noHandlerResponse: noHandlerResponse, errorResponseFunction: errorResponseFunction, addResponseHeaders: addResponseHeaders, addResponseCookies: addResponseCookies) {
        this.router = router;
        this.errorResponse = errorResponse;
        this.errorResponseFunction = errorResponseFunction;
        this.noHandlerResponse = noHandlerResponse;
        this.addResponseHeaders = addResponseHeaders;
        this.addResponseCookies = addResponseCookies;
    }

    async execute<testMethod extends httpMethod, testPath extends `/${string}`>(req: lrRequest<testMethod, testPath>): Promise<lrAppReturn<this, testMethod, testPath>> {
        try {

            let response: LrResponse<lrResponseObject>;

            try {
                const routerResponse: LrResponse<lrResponseObject> | typeof lrNext = await this.router.execute(req);

                if (routerResponse === lrNext) {
                    const noHandlerResponse = await this.noHandlerResponse(req);

                    if (!(noHandlerResponse instanceof LrResponse)) {
                        throw new Error(`noHandlerResponse must return LrResponse, got typeof ${typeof noHandlerResponse}`);
                    }

                    response = noHandlerResponse;
                } else {
                    if (!((routerResponse as any) instanceof LrResponse)) {
                        throw new Error(`handler must return LrResponse, got typeof ${typeof routerResponse}`);
                    }

                    response = routerResponse as LrResponse<lrResponseObject>;
                }
            } catch (e) {
                if (!this.errorResponseFunction) {
                    throw e;
                }

                const errorResponse = await this.errorResponseFunction(req, e);

                if (!(errorResponse instanceof LrResponse)) {
                    throw new Error(`errorResponseFunction must return LrResponse, got typeof ${typeof errorResponse}`);
                }

                response = errorResponse;
            }

            if (this.addResponseHeaders) {
                const headers = await this.addResponseHeaders(req, response);
                response = response.headers(headers);
            }

            if (this.addResponseCookies) {
                const cookies = await this.addResponseCookies(req, response);
                response = response.cookies(cookies) as LrResponse<lrResponseObject>;
            }

            return response as lrAppReturn<this, testMethod, testPath>;

        } catch (e2) {
            console.warn('[lfm-router] Unhandled error', e2);
            return this.errorResponse as lrAppReturn<this, testMethod, testPath>;
        }
    }

    async nodeExecute(nodeReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {
        const req = await transformNodeRequest(nodeReq);

        const response = await this.execute(req);

        await sendNodeResponse(nodeRes, response);
    }
};

type responseHeadersWrapper<
    addResponseHeaders extends generalAddResponseHeaders | undefined,
    response extends lrResponseObject
> =
    addResponseHeaders extends (req: any, res: any) => infer responseHeaders
    ? (
        Awaited<responseHeaders> extends Record<string, string>
        ? responseWithHeaders<response, Awaited<responseHeaders>>
        : response
    )
    : response;

type responseCookiesWrapper<
    addResponseCookies extends generalAddResponseCookies | undefined,
    response extends lrResponseObject
> =
    addResponseCookies extends (req: any, res: any) => infer responseCookies
    ? (
        Awaited<responseCookies> extends Record<
            string,
            { value: string; } & Partial<responseCookieOptions>
        >
        ? responseWithCookies<response, Awaited<responseCookies>>
        : response
    )
    : response;

type responseWrapper<
    addResponseHeaders extends generalAddResponseHeaders | undefined,
    addResponseCookies extends generalAddResponseCookies | undefined,
    response extends LrResponse<lrResponseObject>
> =
    response extends LrResponse<infer responseObject>
    ? LrResponse<
        responseHeadersWrapper<addResponseHeaders,
            responseCookiesWrapper<addResponseCookies,
                responseObject
            >
        >
    >
    : never;

export type lrAppReturn<
    app extends LrApp<
        '' | `/${string}`,
        generalHandlerOrRouter[],
        LrResponse<lrResponseObject>,
        noHandlerResponseFunction,
        generalErrorResponseFunction | undefined,
        generalAddResponseHeaders | undefined,
        generalAddResponseCookies | undefined
    >,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    app extends LrApp<
        infer pathPrefix,
        infer handlers,
        infer errorResponse,
        infer noHandlerResponse,
        infer errorResponseFunction,
        infer addResponseHeaders,
        infer addResponseCookies
    > ?
    (
        | responseWrapper<addResponseHeaders, addResponseCookies,
            Exclude<lrRouterReturn<LrRouter<pathPrefix, handlers>, testMethod, testPath>, typeof lrNext>
        >
        | responseWrapper<addResponseHeaders, addResponseCookies, (
            errorResponseFunction extends (...args: any[]) => infer returnErrorResponseFunction
            ? (
                Awaited<returnErrorResponseFunction> extends LrResponse<lrResponseObject>
                ? Awaited<returnErrorResponseFunction>
                : never
            )
            : never
        )>
        | responseWrapper<addResponseHeaders, addResponseCookies, (
            canRouterCallNext<pathPrefix, handlers, testMethod, testPath> extends true
            ? Awaited<ReturnType<noHandlerResponse>>
            : never
        )>
        | errorResponse
    ) : never;

export type lrAppRequirements<
    app extends LrApp<
        '' | `/${string}`,
        generalHandlerOrRouter[],
        LrResponse<lrResponseObject>,
        noHandlerResponseFunction,
        generalErrorResponseFunction | undefined,
        generalAddResponseHeaders | undefined,
        generalAddResponseCookies | undefined
    >,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    lrRouterRequirements<app['router'], testMethod, testPath>;

export function lrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    options extends {
        errorResponse: LrResponse<lrResponseObject>;
        noHandlerResponse: noHandlerResponseFunction;
        errorResponseFunction?: generalErrorResponseFunction;
        addResponseHeaders?: generalAddResponseHeaders;
        addResponseCookies?: generalAddResponseCookies;
    }
>(router: LrRouter<pathPrefix, handlers>, options: options):
    LrApp<
        pathPrefix,
        handlers,
        options['errorResponse'],
        options['noHandlerResponse'],
        unknown extends options['errorResponseFunction'] ? undefined : options['errorResponseFunction'],
        unknown extends options['addResponseHeaders'] ? undefined : options['addResponseHeaders'],
        unknown extends options['addResponseCookies'] ? undefined : options['addResponseCookies']
    > {
    return new LrApp(
        router,
        options.errorResponse,
        options.noHandlerResponse,
        options.errorResponseFunction as any,
        options.addResponseHeaders as any,
        options.addResponseCookies as any
    );
}
