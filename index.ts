import type { httpMethod, matchRequest, pathDefinitionToType, pathDefinitionToParams, methodsDefinitionToMethods, recursiveSimplify, simplify } from "./types";
// import type { z } from 'zod';
// todo: only type import and dev dep
import { z } from 'zod';

// typescript sometimes converts the Symbol('lrNext') to symbol, so we just convert it to a special object
export const lrNext = Symbol('lrNext') as unknown as 'lrNext' & { __lrNext: symbol };

const defaultStatusMessages = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    410: 'Gone',
    413: 'Content Too Large',
    415: 'Unsupported Media Type',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    503: 'Service Unavailable',
} as const;

type responseBody = {
    toStringifyBody: any;
    body: null;
} | {
    toStringifyBody: null;
    body: string;
};

type responseCookieOptions = {
    httpOnly: boolean;
    secure: boolean;
    partitioned: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    path: string;
    domain: string;
    maxAge: number;
};

const defaultResponseCookieOptions = {
    httpOnly: false,
    secure: false,
    partitioned: false,
    sameSite: 'lax',
    path: '/',
    domain: '',
    /** 60 * 60 * 24 * 365 */
    maxAge: 31536000,
} as const satisfies responseCookieOptions;

type responseCookie = {
    value: string;
    options: responseCookieOptions;
};

type lrResponseResponse = {
    status: number;
    statusMessage: string;
    body: responseBody;
    headers: Record<string, string>;
    cookies: Record<string, responseCookie>;
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
    ip: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
};

type lrRequest<
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

class LrResponse<response extends lrResponseResponse> {
    response: response;

    constructor(response: response) {
        this.response = response;
    }

    status<status extends number, statusMessage extends string | undefined = undefined>(status: status, statusMessage?: statusMessage):
        LrResponse<
            simplify<
                {
                    status: status;
                    statusMessage:
                    statusMessage extends undefined
                    ? (
                        status extends keyof typeof defaultStatusMessages
                        ? (typeof defaultStatusMessages)[status]
                        : ''
                    ) : statusMessage;
                }
                & Omit<response, 'status' | 'statusMessage'>
            >
        > {
        return new LrResponse({
            ...this.response,
            status,
            statusMessage: statusMessage ?? defaultStatusMessages[status as keyof typeof defaultStatusMessages] ?? '',
        } as any);
    }

    header<key extends string, value extends string>(key: key, value: value):
        LrResponse<
            simplify<
                Omit<response, 'headers'>
                & {
                    headers: simplify<Omit<response['headers'], key> & { [x in key]: value }>;
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                [key]: value,
            }
        } as any);
    }

    headers<headers extends Record<string, string>>(headers: headers):
        LrResponse<
            simplify<
                Omit<response, 'headers'>
                & {
                    headers: simplify<Omit<response['headers'], keyof headers> & headers>;
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                ...headers,
            }
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
                ...this.response.headers,
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
                    headers: simplify<Omit<response['headers'], 'Content-Type'> & { 'Content-Type': 'text/plain' }>;
                    body: { toStringifyBody: null; body: text }
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                'Content-Type': 'text/plain',
            },
            body: {
                toStringifyBody: null,
                body: text
            }
        } as any);
    }

    redirect<url extends string>(url: url):
        LrResponse<
            simplify<
                {
                    status: 307;
                    statusMessage: (typeof defaultStatusMessages)[307];
                    headers: simplify<Omit<response['headers'], 'Location' | 'Content-Type'> & { 'Location': url; 'Content-Type': 'text/plain' }>;
                    body: { toStringifyBody: null; body: '' }
                } &
                Omit<response, 'status' | 'statusMessage' | 'headers' | 'body'>
            >
        > {
        return new LrResponse({
            ...this.response,
            status: 307,
            statusMessage: defaultStatusMessages[307],
            headers: {
                ...this.response.headers,
                'Location': url,
                'Content-Type': 'text/plain',
            },
            body: {
                toStringifyBody: null,
                body: ''
            }
        } as any);
    }

    permanentRedirect<url extends string>(url: url):
        LrResponse<
            simplify<
                {
                    status: 308;
                    statusMessage: (typeof defaultStatusMessages)[308];
                    headers: simplify<Omit<response['headers'], 'Location' | 'Content-Type'> & { 'Location': url; 'Content-Type': 'text/plain' }>;
                    body: { toStringifyBody: null; body: '' }
                } &
                Omit<response, 'status' | 'statusMessage' | 'headers' | 'body'>
            >
        > {
        return new LrResponse({
            ...this.response,
            status: 308,
            statusMessage: defaultStatusMessages[308],
            headers: {
                ...this.response.headers,
                'Location': url,
                'Content-Type': 'text/plain',
            },
            body: {
                toStringifyBody: null,
                body: ''
            }
        } as any);
    }

    cookie<
        name extends string,
        value extends string,
        options extends Partial<responseCookieOptions> | undefined = undefined
    >(name: name, value: value, options?: options):
        LrResponse<
            simplify<
                Omit<response, 'cookie'>
                & {
                    cookies: simplify<
                        Omit<response['cookies'], name>
                        & {
                            [key in name]: {
                                value: value;
                                options: options extends undefined
                                ? typeof defaultResponseCookieOptions
                                : simplify<
                                    Omit<options, Exclude<keyof options, keyof responseCookieOptions>>
                                    & Omit<typeof defaultResponseCookieOptions, keyof options>
                                >
                            }
                        }
                    >;
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            cookies: {
                ...this.response.cookies,
                [name]: {
                    value,
                    options: options ? {
                        ...defaultResponseCookieOptions,
                        ...options,
                    } : defaultResponseCookieOptions
                },
            }
        } as any);
    }
}

export function lrResponse() {
    return new LrResponse({
        status: 200,
        statusMessage: defaultStatusMessages[200],
        headers: {
            'Content-Type': 'text/html',
        },
        body: {
            toStringifyBody: null,
            body: ''
        },
        cookies: {}
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

    let params: Record<string, string> = {};

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
        req: lrRequest<methodsDefinitionToMethods<methods>, pathDefinitionToType<path>>,
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
    ): Promise<LrResponse<lrResponseResponse> | typeof lrNext> {
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
        => LrResponse<lrResponseResponse> | Promise<LrResponse<lrResponseResponse>>;

type noHandlerResponseFunction =
    (req: lrRequest<httpMethod, `/${string}`>)
        => LrResponse<lrResponseResponse> | Promise<LrResponse<lrResponseResponse>>;

class LrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    errorResponse extends LrResponse<lrResponseResponse>,
    noHandlerResponse extends noHandlerResponseFunction,
    errorResponseFunction extends generalErrorResponseFunction | undefined
> {
    router: LrRouter<pathPrefix, handlers>;
    errorResponse: errorResponse;
    errorResponseFunction: errorResponseFunction;
    noHandlerResponse: noHandlerResponse;

    constructor(router: LrRouter<pathPrefix, handlers>, errorResponse: errorResponse, noHandlerResponse: noHandlerResponse, errorResponseFunction: errorResponseFunction) {
        this.router = router;
        this.errorResponse = errorResponse;
        this.errorResponseFunction = errorResponseFunction;
        this.noHandlerResponse = noHandlerResponse;
    }

    async execute<testMethod extends httpMethod, testPath extends `/${string}`>(req: lrRequest<testMethod, testPath>): Promise<lrAppReturn<this, testMethod, testPath>> {
        try {
            const response = await this.router.execute(req);

            if (response === lrNext) {
                const newResponse = await this.noHandlerResponse(req);

                if (!(newResponse instanceof LrResponse)) {
                    throw new Error(`noHandlerResponse must return LrResponse, got typeof ${typeof newResponse}`);
                }

                return newResponse as lrAppReturn<this, testMethod, testPath>;
            }

            if (!((response as any) instanceof LrResponse)) {
                throw new Error(`handler must return LrResponse, got typeof ${typeof response}`);
            }

            return response as lrAppReturn<this, testMethod, testPath>;
        } catch (e) {
            try {
                if (this.errorResponseFunction) {
                    const newResponse = await this.errorResponseFunction(req, e);

                    if (!(newResponse instanceof LrResponse)) {
                        throw new Error(`errorResponseFunction must return LrResponse, got typeof ${typeof newResponse}`);
                    }

                    return newResponse as any;
                } else {
                    return this.errorResponse;
                }
            } catch (e2) {
                console.warn('[lfm-router] Error while executing errorResponseFunction', e2);
                return this.errorResponse;
            }
        }
    }
};

export type lrAppReturn<
    app extends LrApp<'' | `/${string}`, generalHandlerOrRouter[], LrResponse<lrResponseResponse>, noHandlerResponseFunction, generalErrorResponseFunction | undefined>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    lrRouterReturn<app['router'], testMethod, testPath>
    | (
        app['errorResponseFunction'] extends (...args: any[]) => infer returnErrorResponseFunction
        ? Awaited<returnErrorResponseFunction>
        : never
    )
    | app['errorResponse']
    | (
        canRouterCallNext<app['router']['pathPrefix'], app['router']['handlers'], testMethod, testPath> extends true
        ? Awaited<ReturnType<app['noHandlerResponse']>>
        : never
    );

export type lrAppRequirements<
    app extends LrApp<'' | `/${string}`, generalHandlerOrRouter[], LrResponse<lrResponseResponse>, noHandlerResponseFunction, generalErrorResponseFunction | undefined>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    lrRouterRequirements<app['router'], testMethod, testPath>;

export function lrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    errorResponse extends LrResponse<lrResponseResponse>,
    noHandlerResponse extends noHandlerResponseFunction,
    errorResponseFunction extends generalErrorResponseFunction | undefined = undefined,
>(router: LrRouter<pathPrefix, handlers>, options: { errorResponse: errorResponse, errorResponseFunction?: errorResponseFunction, noHandlerResponse: noHandlerResponse }):
    LrApp<pathPrefix, handlers, errorResponse, noHandlerResponse, errorResponseFunction> {
    return new LrApp(router, options.errorResponse, options.noHandlerResponse, options.errorResponseFunction as errorResponseFunction);
}
