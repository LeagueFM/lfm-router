// © 2026 Oscar Knap - Alle rechten voorbehouden

import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";
import type { lrRouterReturn, lrRouterRequirements, lrAppReturn, lrAppRequirements, LrResponse } from ".";
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

type c = lrRouterReturn<typeof router, 'GET', '/foo/hi'>;

const app = lrApp(router, {
    errorResponse: lrResponse().status(500).json({ success: false } as const),
    // errorResponseFunction: () => lrResponse().status(123),
    noHandlerResponse: (req) => {
        req.method;
        req.path;
        req.params;
        req.body;
        req.query;

        return lrResponse().status(404).json({ success: false } as const);
    },
    addResponseHeaders: (req, res) => ({
        foo: 'bar'
    } as const),
    addResponseCookies: (req, res) => ({
        foo: { value: 'bar' }
    } as const)
});

type a = lrAppReturn<typeof app, 'GET', '/foo/hi'>;
type b = lrAppRequirements<typeof app, 'GET', '/foo/hi'>;

// const server = app.createServer();

// ─── Edge case: nested router prefix consumes full path ───

const edgeRouter = lrRouter('', [
    lrRouter('/foo', [
        lrHandler(['GET'], '/:id', null, () => {
            return lrResponse().json({ reached: true } as const);
        }),
    ]),
] as const);

// Path /foo is fully consumed by prefix /foo, leaving `/` for /:id handler.
// The handler should NOT match because :id would be empty.
// lrRouterReturn should be just typeof lrNext (fall through → noHandlerResponse)
type EdgeNoMatch = lrRouterReturn<typeof edgeRouter, 'GET', '/foo'>;

// When path includes a value for :id, the handler SHOULD match
type EdgeMatch = lrRouterReturn<typeof edgeRouter, 'GET', '/foo/bar'>;

// Same edge case but directly at root level (no nesting)
const rootParamRouter = lrRouter('', [
    lrHandler(['GET'], '/:id', null, () => {
        return lrResponse().json({ reached: true } as const);
    }),
] as const);

// Path / should NOT match /:id because :id would be empty
type RootParamNoMatch = lrRouterReturn<typeof rootParamRouter, 'GET', '/'>;

// Path /hello SHOULD match /:id with id='hello'
type RootParamMatch = lrRouterReturn<typeof rootParamRouter, 'GET', '/hello'>;

// Deep nesting edge case
const deepEdgeRouter = lrRouter('', [
    lrRouter('/a', [
        lrRouter('/b', [
            lrHandler(['GET'], '/:id', null, () => {
                return lrResponse().json({ reached: true } as const);
            }),
        ]),
    ]),
] as const);

// Path /a/b is fully consumed by accumulated prefix /a/b, leaving `/`
type DeepEdgeNoMatch = lrRouterReturn<typeof deepEdgeRouter, 'GET', '/a/b'>;

// Path /a/b/c should match with id='c'
type DeepEdgeMatch = lrRouterReturn<typeof deepEdgeRouter, 'GET', '/a/b/c'>;
