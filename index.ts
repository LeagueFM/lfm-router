const nextSymbol = Symbol('lrNext');

interface iLrResponse {
    status: number;
    contentType: string;
    body: string;
};

type httpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';

type lrRequest = 'todo: lrRequest';
type lrReturn = iLrResponse | typeof nextSymbol;

type lrHandlerCallback = (req: lrRequest) => lrReturn;
type lrMatcher = (req: lrRequest) => boolean;

interface iLrHandler {
    matcher: lrMatcher;
    callback: lrHandlerCallback;
};

class LrRouter {
    handlers: iLrHandler[];

    constructor(handlers: iLrHandler[]) {
        this.handlers = handlers;
    }
}

class LrApp {
    router: LrRouter;

    constructor(router: LrRouter) {
        this.router = router;
    }
}
