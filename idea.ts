import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";
import type { lrRouterReturn, lrRouterRequirements } from ".";
import { z } from 'zod';

const handler1 = lrHandler('*', '/foo/*', {
    body: z.object({
        name: z.string(),
        foo: z.number()
    }),
    query: z.object({
        hi: z.string(),
    }),
    params: z.object({
        '*': z.string().transform(a => parseInt(a)),
    })
}, async req => {
    req.method;
    req.path;
    req.params;
    req.body;
    req.query;

    return lrNext;
});

const handler2 = lrHandler('*', '/*', {
    body: z.object({
        foo: z.string()
    })
}, async req => {
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

// todo: execute function

// const a = router.match('GET', '/');

// const app = lrApp(router);

// const server = app.createServer();
