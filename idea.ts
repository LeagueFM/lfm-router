import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";
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

    return lrResponse();
});

const handler2 = lrHandler('*', '/', {}, async req => {
    // return lrNext();
    // return lrJson({ success: true });
    // return lrStatus(500, lrJson({ success: false }));
    // return lrRedirect('/');
    return lrResponse().status(500).json({ success: false });
});

const router = lrRouter('', [
    handler1,
    handler2,
] as const);

const a = router.match('GET', '/');

// const app = lrApp(router);

// const server = app.createServer();
