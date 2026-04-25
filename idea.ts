import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";
import { z } from 'zod';

const handler1 = lrHandler('*', '/:name/:id/*', {
    body: z.object({
        name: z.string(),
    }),
    params: z.object({
        name: z.string()
        // typescript error if not all properties present
    })
}, async req => {
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

const router = lrRouter('/hi', [
    handler1,
]);

const app = lrApp(router);

const server = app.createServer();
