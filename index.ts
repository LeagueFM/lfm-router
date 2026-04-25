import type { httpMethod, matchRequest } from "./types";

const nextSymbol = Symbol('lrNext');

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

type lrRequest<method extends httpMethod, path extends `/${string}`> = {
    method: method;
    path: path;
    todo: 'rest';
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

type pathParts = ({
    type: 'literal';
    value: string;
} | {
    type: 'param';
    name: string;
})[];

function pathToParts(path: string): pathParts {
    if (!path.startsWith('/')) {
        throw new Error(`Path must start with /, got ${path}`);
    }

    let parts: pathParts = [];

    for (const part of path.slice(1).split('/')) {
        if (part.startsWith(':')) {
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

type lrHandlerCallback = (req: lrRequest<httpMethod, `/${string}`>) => (lrHandlerReturn | Promise<lrHandlerReturn>);

type handlerMatchReturn<callback extends lrHandlerCallback, definitionMethods extends '*' | httpMethod[], definitionPath extends `/${string}`, testMethod extends httpMethod, testPath extends `/${string}`> =
    matchRequest<definitionMethods, definitionPath, testMethod, testPath> extends true ? {
        matches: true;
        handler: LrHandler<definitionMethods, definitionPath, callback>;
    } :
    matchRequest<definitionMethods, definitionPath, testMethod, testPath> extends false ? {
        matches: false;
    } :
    never;

class LrHandler<methods extends '*' | httpMethod[], path extends `/${string}`, callback extends lrHandlerCallback> {
    methods: methods;
    path: path;
    callback: callback;

    pathParts: pathParts;

    constructor(methods: methods, path: path, callback: callback) {
        this.methods = methods;
        this.path = path;
        this.callback = callback;

        this.pathParts = pathToParts(path);
    }

    match<testMethod extends httpMethod, testPath extends `/${string}`>(method: testMethod, path: testPath):
        handlerMatchReturn<callback, methods, path, testMethod, testPath> {
        const methodMatches = this.methods === '*' || this.methods.includes(method);

        if (!methodMatches) return { matches: false } as handlerMatchReturn<callback, methods, path, testMethod, testPath>;

        if (!path.startsWith('/')) {
            throw new Error(`Request path must start with /, got ${path}`);
        }

        const reqPathSplit = path.slice(1).split('/');

        if (reqPathSplit.length < this.pathParts.length) return { matches: false } as handlerMatchReturn<callback, methods, path, testMethod, testPath>;

        for (const stringI in this.pathParts) {
            const i = parseInt(stringI);

            const pathPart = this.pathParts[i];
            const reqPart = reqPathSplit[i];

            if (pathPart.type === 'literal' && pathPart.value !== reqPart) return { matches: false } as handlerMatchReturn<callback, methods, path, testMethod, testPath>;
            if (pathPart.type === 'param') continue;
        }

        return {
            matches: true,
            handler: this,
        } as unknown as handlerMatchReturn<callback, methods, path, testMethod, testPath>;
    }
};

type generalHandler = LrHandler<'*', `/${string}`, lrHandlerCallback> | LrRouter;

class LrRouter<handlers extends generalHandler[] = generalHandler[]> {
    handlers: handlers;

    constructor(handlers: handlers) {
        this.handlers = handlers;
    }

    match<testMethod extends httpMethod, testPath extends `/${string}`>(method: testMethod, path: testPath): {
        matches: false;
    } | {
        matches: true;
        handler: LrHandler;
    } {
        for (const handler of this.handlers) {
            const result = handler.match(req);

            if (result.matches) {
                return result;
            }
        }

        return {
            matches: false,
        };
    }
};

class LrApp {
    router: LrRouter;

    constructor(router: LrRouter) {
        this.router = router;
    }
};

export function lrHandler(methods: '*' | httpMethod[], path: string, callback: lrHandlerCallback): LrHandler {
    return new LrHandler(methods, path, callback);
}

export function lrRouter(handlers: (LrHandler | LrRouter)[]): LrRouter {
    return new LrRouter(handlers);
}

export function lrApp(router: LrRouter): LrApp {
    return new LrApp(router);
}

export function lrNext() {
    return nextSymbol;
}

export function lrResponse() {
    return new LrResponse({
        status: 200,
        contentType: 'text/html',
        body: '',
        headers: {},
    });
}
