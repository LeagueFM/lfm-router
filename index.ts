const nextSymbol = Symbol('lrNext');


type httpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';

interface iLrResponse {
    status: number;
    contentType: string;
    body: string;
    headers: Record<string, string>;
};

interface iLrRequest {
    method: httpMethod;
    path: string;
    todo: 'rest';
};

type lrReturn = LrResponse | typeof nextSymbol;

type lrHandlerCallback = (req: iLrRequest) => lrReturn;

class LrResponse {
    response: iLrResponse;

    constructor(response: iLrResponse) {
        this.response = response;
    }

    status(status: number): LrResponse {
        return new LrResponse({
            ...this.response,
            status
        });
    }

    json(data: any): LrResponse {
        return new LrResponse({
            ...this.response,
            contentType: 'application/json',
            body: JSON.stringify(data),
        });
    }

    text(text: string): LrResponse {
        return new LrResponse({
            ...this.response,
            contentType: 'text/html',
            body: text,
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

class LrHandler {
    methods: '*' | httpMethod[];
    path: string;
    callback: lrHandlerCallback;

    pathParts: pathParts;

    constructor(methods: '*' | httpMethod[], path: string, callback: lrHandlerCallback) {
        this.methods = methods;
        this.path = path;
        this.callback = callback;

        this.pathParts = pathToParts(path);
    }

    match(req: iLrRequest): {
        matches: false;
    } | {
        matches: true;
        handler: LrHandler;
    } {
        const methodMatches = this.methods === '*' || this.methods.includes(req.method);

        if (!methodMatches) return { matches: false };

        if (!req.path.startsWith('/')) {
            throw new Error(`Request path must start with /, got ${req.path}`);
        }

        const reqPathSplit = req.path.slice(1).split('/');

        if (reqPathSplit.length < this.pathParts.length) return { matches: false };

        for (const stringI in this.pathParts) {
            const i = parseInt(stringI);

            const pathPart = this.pathParts[i];
            const reqPart = reqPathSplit[i];

            if (pathPart.type === 'literal' && pathPart.value !== reqPart) return { matches: false };
            if (pathPart.type === 'param') continue;
        }

        return {
            matches: true,
            handler: this,
        };
    }
};

class LrRouter {
    handlers: (LrHandler | LrRouter)[];

    constructor(handlers: (LrHandler | LrRouter)[]) {
        this.handlers = handlers;
    }

    match(req: iLrRequest): {
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
