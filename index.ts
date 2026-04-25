import type { httpMethod, matchRequest, pathDefinitionToType, pathDefinitionToParams, methodsDefinitionToMethods } from "./types";
// import type { z } from 'zod';
// todo: only type import and dev dep
import { z } from 'zod';

const nextSymbol = Symbol('lrNext');

export function lrNext() {
    return nextSymbol;
}

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

type lrRequest<method extends httpMethod, path extends `/${string}`, params extends Record<string, string>, query extends Record<string, string>, body extends any> = {
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

type lrHandlerReturn = LrResponse<lrResponseResponse> | typeof nextSymbol;

type lrHandlerCallback<method extends httpMethod, path extends `/${string}`, params extends Record<string, string>, query extends Record<string, string>, body extends any> =
    (req: lrRequest<method, path, params, query, body>)
        => (lrHandlerReturn | Promise<lrHandlerReturn>);

type handlerMatchReturn<
    methods extends '*' | httpMethod[],
    pathPrefix extends string,
    path extends string,
    validations extends generalValidations<pathDefinitionToParams<path>>,
    callback extends lrHandlerCallback<
        methodsDefinitionToMethods<methods>,
        pathDefinitionToType<path>,
        validations extends { params: any } ? z.output<validations['params']> : pathDefinitionToParams<path>,
        validations extends { query: any } ? z.output<validations['query']> : Record<string, string>,
        validations extends { body: any } ? z.output<validations['body']> : unknown
    >,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    matchRequest<methods, `${pathPrefix}${path}`, testMethod, testPath> extends true ? {
        matches: true;
        handler: LrHandler<methods, path, validations, callback>;
    } :
    matchRequest<methods, `${pathPrefix}${path}`, testMethod, testPath> extends false ? {
        matches: false;
    } :
    never;

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
        handlerMatchReturn<methods, '', path, validations, callback, testMethod, testPath> {
        const methodMatches = this.methods === '*' || this.methods.includes(method);

        if (!methodMatches) return { matches: false } as handlerMatchReturn<methods, '', path, validations, callback, testMethod, testPath>;

        if (!path.startsWith('/')) {
            throw new Error(`Request path must start with /, got ${path}`);
        }

        const reqPathSplit = path.slice(1).split('/');

        if (reqPathSplit.length < this.pathParts.length) return { matches: false } as handlerMatchReturn<methods, '', path, validations, callback, testMethod, testPath>;

        let hasRest = false;

        for (const stringI in this.pathParts) {
            const i = parseInt(stringI);

            const pathPart = this.pathParts[i]!;
            const reqPart = reqPathSplit[i];

            if (pathPart.type === 'literal' && pathPart.value !== reqPart) return { matches: false } as handlerMatchReturn<methods, '', path, validations, callback, testMethod, testPath>;
            if (pathPart.type === 'param') continue;
            if (pathPart.type === 'rest') {
                hasRest = true;
                break;
            }
        }

        if (reqPathSplit.length > this.pathParts.length) {
            if (hasRest) {
                return { matches: true, handler: this } as unknown as handlerMatchReturn<methods, '', path, validations, callback, testMethod, testPath>;
            } else {
                return { matches: false } as handlerMatchReturn<methods, '', path, validations, callback, testMethod, testPath>;
            }
        }

        return {
            matches: true,
            handler: this,
        } as unknown as handlerMatchReturn<methods, '', path, validations, callback, testMethod, testPath>;
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
    handlers extends any[],
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            handlerMatchReturn<
                firstHandlerMethods,
                pathPrefix,
                firstHandlerPath,
                firstHandlerValidations,
                firstHandlerCallback,
                testMethod,
                testPath
            >['matches'] extends true
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
    handlers extends any[],
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    {
        type: 'router';
        router: LrRouter<pathPrefix, handlers>;
        matches: routerMatchReturnInternal<pathPrefix, handlers, testMethod, testPath>;
    };

// todo: think if there is a better type for handlers
// handlers can't be typed more specific here
class LrRouter<pathPrefix extends '' | `/${string}`, handlers extends any[]> {
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
                if (match.matches) {
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

// todo: type handlers better
export function lrRouter<pathPrefix extends '' | `/${string}`, handlers extends any[]>(pathPrefix: pathPrefix, handlers: handlers): LrRouter<pathPrefix, handlers> {
    return new LrRouter(pathPrefix, handlers);
}

// todo: type handlers better
class LrApp<pathPrefix extends '' | `/${string}`, handlers extends any[]> {
    router: LrRouter<pathPrefix, handlers>;

    constructor(router: LrRouter<pathPrefix, handlers>) {
        this.router = router;
    }
};

// todo: type handlers better
export function lrApp<pathPrefix extends '' | `/${string}`, handlers extends any[]>(router: LrRouter<pathPrefix, handlers>): LrApp<pathPrefix, handlers> {
    return new LrApp(router);
}
