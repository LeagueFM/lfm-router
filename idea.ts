import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";
import type { lrRouterReturn, lrRouterRequirements } from ".";
import { z } from 'zod';

const a = z.object({
    name: z.string(),
    foo: z.number()
});

const b = await a.safeParseAsync({});
if (!b.success) {
    // 
}

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
    failResponse: async ({ bodyError, queryError, paramsError }) => {
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

type a = lrRouterReturn<typeof router, 'GET', '/foo/hi'>;
type b = lrRouterRequirements<typeof router, 'GET', '/foo/hi'>;

// const a = router.match('GET', '/');

// const app = lrApp(router);

// const server = app.createServer();
