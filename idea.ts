import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";
import type { lrRouterReturn, lrRouterRequirements, lrAppReturn, lrAppRequirements } from ".";
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
    }),
    failResponse: async (req, { bodyError, queryError, paramsError }) => {
        req.method;
        req.path;
        req.params;
        req.body;
        req.query;

        if (bodyError) {
            // return lrNext;
        }

        return lrResponse().status(400).json({ success: false } as const);
    }
}, async req => {
    req.method;
    req.path;
    req.params;
    req.body;
    req.query;

    if (Math.random() < 0.5) {
        return lrNext;
    }

    return lrResponse().status(200).text('Hello world');
});

const handler2 = lrHandler('*', '/*', {
    body: z.object({
        foo: z.string()
    }),
    failResponse: () => lrResponse()
}, async req => {
    // return lrNext();
    // return lrJson({ success: true });
    // return lrStatus(500, lrJson({ success: false }));
    // return lrRedirect('/');
    return lrResponse().status(500).json({ success: false } as const);
});

const router = lrRouter('', [
    handler1,
    // handler2,
] as const);

// const a = router.match('GET', '/');

const app = lrApp(router, {
    errorResponse: lrResponse().status(500).json({ success: false } as const),
    errorResponseFunction: (req, err) => {
        req.method;
        req.path;
        req.params;
        req.body;
        req.query;

        return lrResponse().status(500).json({ success: false } as const);
    },
    noHandlerResponse: (req) => {
        req.method;
        req.path;
        req.params;
        req.body;
        req.query;

        return lrResponse().status(404).json({ success: false } as const);
    }
});

type a = lrAppReturn<typeof app, 'GET', '/foo/hi'>;
type b = lrAppRequirements<typeof app, 'GET', '/foo/hi'>;

// const server = app.createServer();
