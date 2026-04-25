import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";
import type { lrRouterReturn } from ".";
import { z } from 'zod';

const handler1 = lrHandler('*', '/foo/*', {
    body: z.object({
        name: z.string(),
    }),
    query: z.object({
        hi: z.string()
    })
}, async req => {
    req.method;
    req.path;
    req.params;
    req.body;
    req.query;

    return lrNext();
});

const handler2 = lrHandler('*', '/*', {}, async req => {
    // return lrNext();
    // return lrJson({ success: true });
    // return lrStatus(500, lrJson({ success: false }));
    // return lrRedirect('/');
    return lrResponse().status(500).json({ success: false } as const);
});

const router = lrRouter('', [
    handler1,
    handler2,
] as const);

type a = lrRouterReturn<typeof router, 'GET', '/foo/hi'>;

// todo: get type of what is needed in request (body, query)
// todo: execute function

// const a = router.match('GET', '/');

// const app = lrApp(router);

// const server = app.createServer();
