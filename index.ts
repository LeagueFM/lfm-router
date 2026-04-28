import type { httpMethod, matchRequest, pathDefinitionToType, pathDefinitionToParams, methodsDefinitionToMethods, recursiveSimplify, simplify } from "./types";
// import type { z } from 'zod';
// todo: only type import and dev dep
import { z } from 'zod';

// typescript sometimes converts the Symbol('lrNext') to symbol, so we just convert it to a special object
export const lrNext = Symbol('lrNext') as unknown as 'lrNext' & { __lrNext: symbol };

type responseBody = {
    toStringifyBody: any;
    body: null;
} | {
    toStringifyBody: null;
    body: string;
};

type lrResponseResponse = {
    status: number;
    body: responseBody;
    headers: Record<string, string>;
};

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
};

type lrRequest<
    method extends httpMethod,
    path extends `/${string}`,
    // string, because this is before zod parsing, and null because this could be in a situation where there is no path definition
    params extends null | Record<string, string>
> = {
    method: method;
    path: path;
    params: params;
    query: Record<string, string>; // not generic, because this is before zod parsing
    body: unknown; // not generic, because this is before zod parsing
    data: object;
};

class LrResponse<response extends lrResponseResponse> {
    response: response;

    constructor(response: response) {
        this.response = response;
    }

    status<status extends number>(status: status): LrResponse<simplify<{ status: status } & Omit<response, 'status'>>> {
        return new LrResponse({
            ...this.response,
            status
        } as any);
    }

    json<data>(data: data):
        LrResponse<
            simplify<
                Omit<response, 'headers' | 'body'>
                & {
                    headers: simplify<Omit<response['headers'], 'Content-Type'> & { 'Content-Type': 'application/json' }>;
                    body: { toStringifyBody: data; body: null }
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                'Content-Type': 'application/json',
            },
            body: {
                toStringifyBody: data,
                body: null
            }
        } as any);
    }

    text<text extends string>(text: text):
        LrResponse<
            simplify<
                Omit<response, 'headers' | 'body'>
                & {
                    headers: simplify<Omit<response['headers'], 'Content-Type'> & { 'Content-Type': 'text/html' }>;
                    body: { toStringifyBody: null; body: text }
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                'Content-Type': 'text/html',
            },
            body: {
                toStringifyBody: null,
                body: text
            }
        } as any);
    }
}

export function lrResponse() {
    return new LrResponse({
        status: 200,
        headers: {
            'Content-Type': 'text/html',
        },
        body: {
            toStringifyBody: null,
            body: ''
        },
    } as const);
}

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

type lrHandlerReturn = LrResponse<lrResponseResponse> | typeof lrNext;

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
        req: lrRequest<methodsDefinitionToMethods<methods>, pathDefinitionToType<path>, pathDefinitionToParams<path>>,
        errors: {
            bodyError: z.ZodError | null;
            queryError: z.ZodError | null;
            paramsError: z.ZodError | null;
        }
    ) => LrResponse<lrResponseResponse> | Promise<LrResponse<lrResponseResponse>>;
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

    pathParts: pathParts;

    constructor(methods: methods, path: path, validations: validations, callback: callback) {
        this.methods = methods;
        this.path = path;
        this.validations = validations;
        this.callback = callback;

        this.pathParts = pathToParts(path);
    }

    match<testMethod extends httpMethod, testPath extends `/${string}`>(method: testMethod, path: testPath):
        matchRequest<methods, path, testMethod, testPath> {
        const methodMatches = this.methods === '*' || this.methods.includes(method);

        if (!methodMatches) return false as matchRequest<methods, path, testMethod, testPath>;

        if (!path.startsWith('/')) {
            throw new Error(`Request path must start with /, got ${path}`);
        }

        const reqPathSplit = path.slice(1).split('/');

        if (reqPathSplit.length < this.pathParts.length) return false as matchRequest<methods, path, testMethod, testPath>;

        let hasRest = false;

        for (const stringI in this.pathParts) {
            const i = parseInt(stringI);

            const pathPart = this.pathParts[i]!;
            const reqPart = reqPathSplit[i];

            if (pathPart.type === 'literal' && pathPart.value !== reqPart) return false as matchRequest<methods, path, testMethod, testPath>;
            if (pathPart.type === 'param') continue;
            if (pathPart.type === 'rest') {
                hasRest = true;
                break;
            }
        }

        if (reqPathSplit.length > this.pathParts.length) {
            if (hasRest) {
                return true as matchRequest<methods, path, testMethod, testPath>;
            } else {
                return false as matchRequest<methods, path, testMethod, testPath>;
            }
        }

        return true as matchRequest<methods, path, testMethod, testPath>;
    }

    // todo: improve typing
    async execute(req: lrRequest<httpMethod, `/${string}`, Record<string, any>>) {
        let newReq = { ...req };

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
                    // @ts-ignore todo
                    newReq.query = queryResult.data;
                }
            }

            if (this.validations.params) {
                const paramsResult = await this.validations.params.safeParseAsync(newReq.params);

                if (!paramsResult.success) {
                    paramsError = paramsResult.error;
                } else {
                    // @ts-ignore todo
                    newReq.params = paramsResult.data;
                }
            }

            if (bodyError || queryError || paramsError) {
                // @ts-ignore todo
                const response = await this.validations.failResponse(req, { bodyError, queryError, paramsError });

                return response;
            }
        }

        // @ts-ignore todo
        const response = await this.callback(newReq);

        return response;
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

        let matches = [];

        for (const handler of this.handlers) {
            if (handler instanceof LrHandler) {
                const match = handler.match(method, (this.pathPrefix + path) as `/${string}`);
                if (match) {
                    matches.push({
                        type: 'handler',
                        handler
                    });
                }
            } else if (handler instanceof LrRouter) {
                const match = handler.match(method, (this.pathPrefix + path) as `/${string}`);
                if (match.matches) {
                    matches.push({
                        type: 'router',
                        router: handler,
                        matches: match.matches
                    });
                }
            }
        }

        return {
            type: 'router',
            router: this,
            matches: matches as routerMatchReturnInternal<pathPrefix, handlers, testMethod, testPath>
        };
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
    (req: lrRequest<httpMethod, `/${string}`, null>, error: unknown)
        => LrResponse<lrResponseResponse> | Promise<LrResponse<lrResponseResponse>>;

type noHandlerResponseFunction =
    (req: lrRequest<httpMethod, `/${string}`, null>)
        => LrResponse<lrResponseResponse> | Promise<LrResponse<lrResponseResponse>>;

class LrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    errorResponse extends LrResponse<lrResponseResponse>,
    errorResponseFunction extends generalErrorResponseFunction,
    noHandlerResponse extends noHandlerResponseFunction
> {
    router: LrRouter<pathPrefix, handlers>;
    errorResponse: errorResponse;
    errorResponseFunction: errorResponseFunction;
    noHandlerResponse: noHandlerResponse;

    constructor(router: LrRouter<pathPrefix, handlers>, options: { errorResponse: errorResponse, errorResponseFunction: errorResponseFunction, noHandlerResponse: noHandlerResponse }) {
        this.router = router;
        this.errorResponse = options.errorResponse;
        this.errorResponseFunction = options.errorResponseFunction;
        this.noHandlerResponse = options.noHandlerResponse;
    }

    // todo: type better
    async execute(req: lrRequest<httpMethod, `/${string}`, null>) {
        const match = this.router.match(req.method, req.path);

        // todo: error handling

        const response = await this.#executeInternal(match, req);

        if (!response) {
            // todo: check if return instanceof LrResponse
            return this.noHandlerResponse(req);
        }

        // todo: check if return instanceof LrResponse
        return response;
    }

    // todo: type better
    // @ts-ignore todo
    async #executeInternal(match: any, req: any) {
        if (match.type === 'handler') {
            // todo: check if return instanceof LrResponse
            return await match.handler.execute(req);
        } else if (match.type === 'router') {
            for (const innerMatch of match.matches) {
                // @ts-ignore todo
                const response = await this.#executeInternal(innerMatch, req);

                if (response) {
                    return response;
                }
            }
        }

        return null;
    }
};

export type lrAppReturn<
    app extends LrApp<'' | `/${string}`, generalHandlerOrRouter[], LrResponse<lrResponseResponse>, generalErrorResponseFunction, noHandlerResponseFunction>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    lrRouterReturn<app['router'], testMethod, testPath>
    | Awaited<ReturnType<app['errorResponseFunction']>>
    | app['errorResponse']
    | (
        canRouterCallNext<app['router']['pathPrefix'], app['router']['handlers'], testMethod, testPath> extends true
        ? Awaited<ReturnType<app['noHandlerResponse']>>
        : never
    );

export type lrAppRequirements<
    app extends LrApp<'' | `/${string}`, generalHandlerOrRouter[], LrResponse<lrResponseResponse>, generalErrorResponseFunction, noHandlerResponseFunction>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    lrRouterRequirements<app['router'], testMethod, testPath>;

export function lrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    errorResponse extends LrResponse<lrResponseResponse>,
    errorResponseFunction extends generalErrorResponseFunction,
    noHandlerResponse extends noHandlerResponseFunction
>(router: LrRouter<pathPrefix, handlers>, options: { errorResponse: errorResponse, errorResponseFunction: errorResponseFunction, noHandlerResponse: noHandlerResponse }): LrApp<pathPrefix, handlers, errorResponse, errorResponseFunction, noHandlerResponse> {
    return new LrApp(router, options);
}
