import type { httpMethod, matchRequest, pathDefinitionToType, pathDefinitionToParams, methodsDefinitionToMethods } from "./types";
// import type { z } from 'zod';
// todo: only type import and dev dep
import { z } from 'zod';

// typescript sometimes converts the Symbol('lrNext') to symbol, so we just convert it to a special object
export const lrNext = Symbol('lrNext') as unknown as { __lrNext: symbol };

type responseBody = {
    toStringifyBody: any;
    body: null;
} | {
    toStringifyBody: null;
    body: string;
};

type lrResponseResponse = {
    status: number;
    contentType: string;
    body: responseBody;
    headers: Record<string, string>;
};

type lrHandlerRequest<
    method extends httpMethod,
    path extends `/${string}`,
    params extends Record<string, any>, // any, because it can be transformed with zod
    query extends Record<string, any>, // any, because it can be transformed with zod
    body extends any
> = {
    method: method;
    path: path;
    params: params;
    query: query;
    body: body;
};

type lrGeneralRequest<
    method extends httpMethod,
    path extends `/${string}`,
    params extends Record<string, string>,
    query extends Record<string, string>,
    body extends any
> = {
    method: method;
    path: path;
    params: params;
    query: query;
    body: body;
};

class LrResponse<response extends lrResponseResponse> {
    response: response;

    constructor(response: response) {
        this.response = response;
    }

    status<status extends number>(status: status): LrResponse<Omit<response, 'status'> & { status: status }> {
        return new LrResponse({
            ...this.response,
            status
        });
    }

    json<data>(data: data): LrResponse<Omit<response, 'contentType' | 'body'> & { contentType: 'application/json'; body: { toStringifyBody: data; body: null } }> {
        return new LrResponse({
            ...this.response,
            contentType: 'application/json',
            body: {
                toStringifyBody: data,
                body: null
            }
        });
    }

    text(text: string): LrResponse<Omit<response, 'contentType' | 'body'> & { contentType: 'text/html'; body: { toStringifyBody: null; body: string } }> {
        return new LrResponse({
            ...this.response,
            contentType: 'text/html',
            body: {
                toStringifyBody: null,
                body: text
            }
        });
    }
}

export function lrResponse() {
    return new LrResponse({
        status: 200,
        contentType: 'text/html',
        body: {
            toStringifyBody: null,
            body: ''
        },
        headers: {},
    });
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
    (req: lrHandlerRequest<method, path, params, query, body>)
        => (lrHandlerReturn | Promise<lrHandlerReturn>);

type generalValidations<params extends object> = {
    body?: z.ZodType;
    query?: z.ZodType<unknown, Record<string, string>>;
    params?: z.ZodType<unknown, params>;
};

class LrHandler<
    methods extends '*' | httpMethod[],
    path extends string,
    validations extends generalValidations<pathDefinitionToParams<path>>,
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

    async execute<
        testMethod extends httpMethod,
        testPath extends `/${string}`,
        params extends pathDefinitionToParams<path>,
        query extends Record<string, string>,
        body extends any
    >(req: lrGeneralRequest<testMethod, testPath, params, query, body>):
        Promise<Awaited<ReturnType<callback>>> {
        if (this.validations.params) {
            const result = this.validations.params.safeParse(req.params);

            // todo: what do we do with errors?
            // todo
        }
    }
};

export function lrHandler<
    methods extends '*' | httpMethod[],
    path extends `/${string}`,
    validations extends generalValidations<pathDefinitionToParams<path>>,
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
    handlers extends generalHandler[],
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    {
        type: 'router';
        router: LrRouter<pathPrefix, handlers>;
        matches: routerMatchReturnInternal<pathPrefix, handlers, testMethod, testPath>;
    };

type generalHandler = LrHandler<any, any, any, any> | LrRouter<any, any>;

class LrRouter<pathPrefix extends '' | `/${string}`, handlers extends generalHandler[]> {
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

// handlers can't be typed more specific here
type canRouterCallNext<handlers extends any[]> =
    handlers extends [...infer firstHandlers, infer lastHandler]
    ? (
        lastHandler extends LrHandler<infer lastHandlerMethods, infer lastHandlerPath, infer lastHandlerValidations, infer lastHandlerCallback>
        ? (
            (typeof lrNext) extends ReturnType<lastHandlerCallback> ? true : false
        ) : (
            lastHandler extends LrRouter<infer lastHandlerPathPrefix, infer lastHandlerHandlers>
            ? (
                canRouterCallNext<lastHandlerHandlers>
            ) : never // invalid lastHandler
        )
    ) : false;

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
                (typeof lrNext) extends ReturnType<firstHandlerCallback> ? (
                    Exclude<ReturnType<firstHandlerCallback>, typeof lrNext | Promise<typeof lrNext>> | routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                ) : (Promise<typeof lrNext>) extends ReturnType<firstHandlerCallback> ? (
                    Exclude<ReturnType<firstHandlerCallback>, typeof lrNext | Promise<typeof lrNext>> | routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                ) : (
                    Exclude<ReturnType<firstHandlerCallback>, typeof lrNext | Promise<typeof lrNext>>
                )
            )
            : routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                canRouterCallNext<firstHandlerHandlers> extends true
                ? (
                    routerReturnInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                    | routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                ) : (
                    routerReturnInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                )
            ) : never
        )
    ) : (
        // no handlers
        never
    );

export type lrRouterReturn<
    router extends LrRouter<'' | `/${string}`, generalHandler[]>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    router extends LrRouter<infer pathPrefix, infer handlers>
    ? (
        routerReturnInternal<pathPrefix, handlers, testMethod, testPath>
    ) : never;

type or<a, b> = a extends true ? true : b;

type validationsToRequirements<
    validations extends generalValidations<any>
> =
    {
        body: validations extends { body: z.ZodType } ? z.input<validations['body']> : any;
        query: validations extends { query: z.ZodType } ? z.input<validations['query']> : any;
    };

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
                (typeof lrNext) extends ReturnType<firstHandlerCallback> ? (
                    validationsToRequirements<firstHandlerValidations> & routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
                ) : (Promise<typeof lrNext>) extends ReturnType<firstHandlerCallback> ? (
                    validationsToRequirements<firstHandlerValidations> & routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
                ) : (
                    validationsToRequirements<firstHandlerValidations>
                )
            ) : routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                canRouterCallNext<firstHandlerHandlers> extends true
                ? (
                    routerRequirementsInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                    & routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
                ) : (
                    routerRequirementsInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                )
            ) : never
        )
    ) : (
        // no handlers
        { body: any; query: Record<string, string> }
    )
    ;

export type lrRouterRequirements<
    router extends LrRouter<'' | `/${string}`, generalHandler[]>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    router extends LrRouter<infer pathPrefix, infer handlers>
    ? (
        routerRequirementsInternal<pathPrefix, handlers, testMethod, testPath>
    ) : never;

export function lrRouter<pathPrefix extends '' | `/${string}`, handlers extends generalHandler[]>(pathPrefix: pathPrefix, handlers: handlers): LrRouter<pathPrefix, handlers> {
    return new LrRouter(pathPrefix, handlers);
}

class LrApp<pathPrefix extends '' | `/${string}`, handlers extends generalHandler[]> {
    router: LrRouter<pathPrefix, handlers>;

    constructor(router: LrRouter<pathPrefix, handlers>) {
        this.router = router;
    }
};

export function lrApp<pathPrefix extends '' | `/${string}`, handlers extends generalHandler[]>(router: LrRouter<pathPrefix, handlers>): LrApp<pathPrefix, handlers> {
    return new LrApp(router);
}
