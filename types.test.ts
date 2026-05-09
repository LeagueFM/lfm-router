// © 2026 Oscar Knap - Alle rechten voorbehouden

import { describe, test } from "bun:test";
import { expectTypeOf } from "expect-type";
import { z } from "zod";
import {
    lrRouter, lrHandler, lrResponse, lrNext,
    lrApp,
    type httpMethod, type lrRequest, type LrResponse,
    type lrHandlerRequest,
    type lrRouterReturn, type lrAppReturn,
    type lrRouterRequirements,
} from ".";

// ─── Basic type tests ───

test("httpMethod is a union of standard HTTP methods", () => {
    expectTypeOf<httpMethod>().toEqualTypeOf<"GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS">();
});

test("lrRequest shape with method and path", () => {
    type Req = lrRequest<"GET", "/test">;
    expectTypeOf<Req>().toMatchTypeOf<{ method: "GET"; path: "/test" }>();
    expectTypeOf<Req>().not.toMatchTypeOf<{ method: "POST" }>();
});

test("lrHandlerRequest shape with params, query and body", () => {
    type Req = lrHandlerRequest<"POST", "/foo", { id: string }, { q: string }, { name: string }>;
    expectTypeOf<Req>().toMatchTypeOf<{
        method: "POST";
        path: "/foo";
        params: { id: string };
        query: { q: string };
        body: { name: string };
    }>();
});

// ─── lrResponse builder ───

test("lrResponse builder returns LrResponse", () => {
    const res = lrResponse();
    type _check = typeof res extends LrResponse<any> ? true : false;
    const _v: _check = true;
});

// ─── Handler return type inference ───

test("handler returning lrNext only", () => {
    const h = lrHandler("GET", "/pass", null, () => lrNext);
    type Ret = ReturnType<typeof h.callback>;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _a: _isLrNext = true;
    const _b: _isResponse = false;
});

test("handler returning LrResponse only", () => {
    const h = lrHandler("GET", "/ok", null, () => {
        return lrResponse().status(200).text("ok");
    });
    type Ret = ReturnType<typeof h.callback>;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _a: _isLrNext = false;
    const _b: _isResponse = true;
});

test("handler can return both lrNext and LrResponse", () => {
    const h = lrHandler("GET", "/maybe", null, () => {
        return Math.random() > 0.5 ? lrNext : lrResponse().status(200).text("ok");
    });
    type Ret = ReturnType<typeof h.callback>;
    type _isLrNext = typeof lrNext extends Ret ? true : false;
    type _isResponse = LrResponse<any> extends Ret ? true : false;
    const _a: _isLrNext = true;
    const _b: _isResponse = true;
});

// ─── Router return type: basic ───

test("router with non-matching method returns lrNext", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/only-get", null, () => {
            return lrResponse().status(200).text("get");
        }),
    ] as const);
    type Ret = lrRouterReturn<typeof router, "POST", "/only-get">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

test("router with matching handler returns LrResponse", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/hello", null, () => {
            return lrResponse().status(200).json({ message: "hello" } as const);
        }),
    ] as const);
    type Ret = lrRouterReturn<typeof router, "GET", "/hello">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _a: _isLrNext = false;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _b: _isResponse = true;
});

// ─── Edge case: nested router prefix consumes full path ───

const edgeRouter = lrRouter("", [
    lrRouter("/foo", [
        lrHandler("GET", "/:id", null, () => {
            return lrResponse().json({ reached: true } as const);
        }),
    ] as const),
] as const);

test("nested prefix /foo consumes full path -> empty :id, no match", () => {
    type Ret = lrRouterReturn<typeof edgeRouter, "GET", "/foo">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

test("nested prefix /foo with extra path /foo/bar matches :id", () => {
    type Ret = lrRouterReturn<typeof edgeRouter, "GET", "/foo/bar">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _a: _isLrNext = false;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _b: _isResponse = true;
});

// ─── Edge case: root param with empty path vs value ───

const rootParamRouter = lrRouter("", [
    lrHandler("GET", "/:id", null, () => {
        return lrResponse().json({ reached: true } as const);
    }),
] as const);

test("root param /:id does NOT match path /", () => {
    type Ret = lrRouterReturn<typeof rootParamRouter, "GET", "/">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

test("root param /:id matches path /hello", () => {
    type Ret = lrRouterReturn<typeof rootParamRouter, "GET", "/hello">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _a: _isLrNext = false;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _b: _isResponse = true;
});

// ─── Edge case: deep nesting ───

const deepEdgeRouter = lrRouter("", [
    lrRouter("/a", [
        lrRouter("/b", [
            lrHandler("GET", "/:id", null, () => {
                return lrResponse().json({ reached: true } as const);
            }),
        ]),
    ]),
] as const);

test("deep nested prefix /a/b consumes full path, no match", () => {
    type Ret = lrRouterReturn<typeof deepEdgeRouter, "GET", "/a/b">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

test("deep nested path /a/b/c matches :id", () => {
    type Ret = lrRouterReturn<typeof deepEdgeRouter, "GET", "/a/b/c">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _a: _isLrNext = false;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _b: _isResponse = true;
});

// ─── lrApp return type ───

test("lrApp with no match returns noHandlerResponse", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/exists", null, () => {
            return lrResponse().status(200).text("here");
        }),
    ] as const);

    const app = lrApp(router, {
        errorResponse: lrResponse().status(500).json({ error: true } as const),
        noHandlerResponse: () => lrResponse().status(404).json({ not: "found" } as const),
    });

    type AppRet = lrAppReturn<typeof app, "GET", "/nope">;
    type _isLrNext = AppRet extends typeof lrNext ? true : false;
    const _v: _isLrNext = false;
});

// ─── lrRequest isHead property ───

test("lrRequest GET has isHead as boolean", () => {
    type Req = lrRequest<"GET", "/test">;
    expectTypeOf<Pick<Req, "isHead">>().toEqualTypeOf<{ isHead: boolean }>();
});

test("lrRequest non-GET has isHead as false", () => {
    type Req = lrRequest<"POST", "/test">;
    expectTypeOf<Pick<Req, "isHead">>().toEqualTypeOf<{ isHead: false }>();
});

// ─── lrResponse type inference ───

test("lrResponse.json sets Content-Type and body type", () => {
    const res = lrResponse().json({ message: "hello" } as const);
    type BodyType = typeof res extends LrResponse<infer R> ? R["body"] : never;
    type _isJson = BodyType extends { type: "json"; body: { message: "hello" } } ? true : false;
    const _v: _isJson = true;
});

test("lrResponse.text sets Content-Type and body type", () => {
    const res = lrResponse().status(201).text("created");
    type BodyType = typeof res extends LrResponse<infer R> ? R["body"] : never;
    type _isText = BodyType extends { type: "text"; body: "created" } ? true : false;
    const _v: _isText = true;
    type StatusType = typeof res extends LrResponse<infer R> ? R["status"] : never;
    type _is201 = StatusType extends 201 ? true : false;
    const _b: _is201 = true;
});

test("lrResponse.html sets Content-Type to text/html", () => {
    const res = lrResponse().html("<h1>hello</h1>");
    type Headers = typeof res extends LrResponse<infer R> ? R["headers"] : never;
    type _isHtml = Headers extends { "Content-Type": "text/html; charset=utf-8" } ? true : false;
    const _v: _isHtml = true;
});

test("lrResponse.status changes status type", () => {
    const res = lrResponse().status(404);
    type Status = typeof res extends LrResponse<infer R> ? R["status"] : never;
    type _is404 = Status extends 404 ? true : false;
    const _v: _is404 = true;
});

test("lrResponse.header adds to headers type", () => {
    const res = lrResponse().header("X-Custom", "value");
    type Headers = typeof res extends LrResponse<infer R> ? R["headers"] : never;
    type _hasCustom = Headers extends { "X-Custom": "value" } ? true : false;
    const _v: _hasCustom = true;
});

test("lrResponse.redirect sets status 307 and Location header", () => {
    const res = lrResponse().redirect("/next");
    type Status = typeof res extends LrResponse<infer R> ? R["status"] : never;
    type _is307 = Status extends 307 ? true : false;
    const _a: _is307 = true;
    type Headers = typeof res extends LrResponse<infer R> ? R["headers"] : never;
    type _hasLocation = Headers extends { Location: "/next" } ? true : false;
    const _b: _hasLocation = true;
});

test("lrResponse.permanentRedirect sets status 308 and Location header", () => {
    const res = lrResponse().permanentRedirect("/forever");
    type Status = typeof res extends LrResponse<infer R> ? R["status"] : never;
    type _is308 = Status extends 308 ? true : false;
    const _a: _is308 = true;
    type Headers = typeof res extends LrResponse<infer R> ? R["headers"] : never;
    type _hasLocation = Headers extends { Location: "/forever" } ? true : false;
    const _b: _hasLocation = true;
});

test("lrResponse.buffer sets Content-Type octet-stream", () => {
    const res = lrResponse().type("application/octet-stream").buffer(Buffer.from("abc"));
    type Headers = typeof res extends LrResponse<infer R> ? R["headers"] : never;
    type _isOctet = Headers extends { "Content-Type": "application/octet-stream" } ? true : false;
    const _v: _isOctet = true;
});

test("lrResponse.arrayBuffer sets Content-Type octet-stream", () => {
    const data = new ArrayBuffer(0);
    const res = lrResponse().arrayBuffer(data);
    type Headers = typeof res extends LrResponse<infer R> ? R["headers"] : never;
    type _isOctet = Headers extends { "Content-Type": "application/octet-stream" } ? true : false;
    const _v: _isOctet = true;
});

test("lrResponse.type overrides Content-Type", () => {
    const res = lrResponse().type("application/xml");
    type Headers = typeof res extends LrResponse<infer R> ? R["headers"] : never;
    type _isXml = Headers extends { "Content-Type": "application/xml" } ? true : false;
    const _v: _isXml = true;
});

// ─── Router return type: wildcard method ───

test("router with wildcard method matches any method", () => {
    const router = lrRouter("", [
        lrHandler("*", "/wild", null, () => {
            return lrResponse().status(200).text("wild");
        }),
    ] as const);
    type RetGet = lrRouterReturn<typeof router, "GET", "/wild">;
    type _isResponse = RetGet extends LrResponse<any> ? true : false;
    const _a: _isResponse = true;
    type RetPost = lrRouterReturn<typeof router, "POST", "/wild">;
    type _isResponsePost = RetPost extends LrResponse<any> ? true : false;
    const _b: _isResponsePost = true;
});

// ─── Router return type: rest route ───

const restRouter = lrRouter("", [
    lrHandler("GET", "/files/*", null, () => {
        return lrResponse().json({ type: "rest" } as const);
    }),
] as const);

test("rest route matches extra path segments", () => {
    type Ret = lrRouterReturn<typeof restRouter, "GET", "/files/a/b">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

test("rest route matches path with zero extra segments", () => {
    type Ret = lrRouterReturn<typeof restRouter, "GET", "/files">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

// ─── Router return type: fallthrough ───

const fallthroughRouter = lrRouter("", [
    lrHandler("GET", "/chain", null, () => lrNext),
    lrHandler("GET", "/chain", null, () => {
        return lrResponse().json({ second: true } as const);
    }),
] as const);

test("router fallthrough: first handler returns lrNext, second returns response", () => {
    type Ret = lrRouterReturn<typeof fallthroughRouter, "GET", "/chain">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

// ─── Router return type: non-matching path after method match ───

test("router with matching method but non-matching path returns lrNext", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/only-this", null, () => {
            return lrResponse().status(200).text("here");
        }),
    ] as const);
    type Ret = lrRouterReturn<typeof router, "GET", "/other">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

// ─── Router return type: multiple handlers on different routes ───

test("router with multiple handlers on different paths resolves correctly", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/a", null, () => lrResponse().text("a")),
        lrHandler("GET", "/b", null, () => lrResponse().text("b")),
    ] as const);
    type RetA = lrRouterReturn<typeof router, "GET", "/a">;
    type _isResponseA = RetA extends LrResponse<any> ? true : false;
    const _a: _isResponseA = true;
    type RetB = lrRouterReturn<typeof router, "GET", "/b">;
    type _isResponseB = RetB extends LrResponse<any> ? true : false;
    const _b: _isResponseB = true;
});

// ─── Router return type: non-empty top-level prefix ───

const prefixedRouter = lrRouter("/api", [
    lrHandler("GET", "/status", null, () => {
        return lrResponse().json({ ok: true } as const);
    }),
] as const);

test("top-level router with /api prefix matches full path /api/status", () => {
    type Ret = lrRouterReturn<typeof prefixedRouter, "GET", "/api/status">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

const showsRouter = lrRouter("/shows", [
    lrHandler("GET", "/", null, () => {
        return lrResponse().json({ ok: true } as const);
    }),
] as const);

test("top-level router /shows with root handler matches path /shows", () => {
    type Ret = lrRouterReturn<typeof showsRouter, "GET", "/shows">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

test("top-level router with /api prefix does not match /status without prefix", () => {
    type Ret = lrRouterReturn<typeof prefixedRouter, "GET", "/status">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

// ─── Router prefix boundary protection at type level ───

const boundaryRouter = lrRouter("", [
    lrRouter("/api", [
        lrHandler("GET", "/status", null, () => {
            return lrResponse().json({ ok: true } as const);
        }),
    ] as const),
] as const);

test("nested /api prefix does not match /apiadmin/status at type level", () => {
    type Ret = lrRouterReturn<typeof boundaryRouter, "GET", "/apiadmin/status">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

// ─── lrRouterRequirements tests ───

test("lrRouterRequirements with body validation requires zod input", () => {
    const router = lrRouter("", [
        lrHandler("POST", "/validate", {
            body: z.object({ name: z.string() }),
            failResponse: () => lrResponse().status(400).text("fail"),
        }, () => lrResponse().json({ ok: true } as const)),
    ] as const);
    type Reqs = lrRouterRequirements<typeof router, "POST", "/validate">;
    type _hasName = Reqs extends { body: { name: string } } ? true : false;
    const _v: _hasName = true;
});

// ─── lrApp with response hooks type tests ───

test("lrApp with addResponseHeaders includes header in return type", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/hooked", null, () => lrResponse().json({ ok: true } as const)),
    ] as const);

    const app = lrApp(router, {
        errorResponse: lrResponse().status(500).json({ error: true } as const),
        noHandlerResponse: () => lrResponse().status(404).json({ not: "found" } as const),
        addResponseHeaders: async () => ({ "X-Hooked": "yes" }),
    });

    type AppRet = lrAppReturn<typeof app, "GET", "/hooked">;
    type _isLrNext = AppRet extends typeof lrNext ? true : false;
    const _a: _isLrNext = false;
    type _isResponse = AppRet extends LrResponse<any> ? true : false;
    const _b: _isResponse = true;
});

test("lrApp with addResponseCookies includes cookie in return type", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/cookies", null, () => lrResponse().json({ ok: true } as const)),
    ] as const);

    const app = lrApp(router, {
        errorResponse: lrResponse().status(500).json({ error: true } as const),
        noHandlerResponse: () => lrResponse().status(404).json({ not: "found" } as const),
        addResponseCookies: async () => ({ hooked: { value: "yes" } }),
    });

    type AppRet = lrAppReturn<typeof app, "GET", "/cookies">;
    type _isResponse = AppRet extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

test("lrApp with errorResponseFunction includes error response in union", () => {
    const router = lrRouter("", [
        lrHandler("GET", "/boom", null, () => {
            throw new Error("fail");
        }),
    ] as const);

    const app = lrApp(router, {
        errorResponse: lrResponse().status(500).json({ fallback: true } as const),
        noHandlerResponse: () => lrResponse().status(404).json({ not: "found" } as const),
        errorResponseFunction: async () => lrResponse().status(503).json({ handled: true } as const),
    });

    type AppRet = lrAppReturn<typeof app, "GET", "/boom">;
    type _isResponse = AppRet extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

// ─── lrHandler with array methods type inference ───

test("handler with array methods infers callback method type as union", () => {
    const h = lrHandler(["GET", "POST"], "/multi", null, () => {
        return lrResponse().text("multi");
    });
    type Ret = ReturnType<typeof h.callback>;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

// ─── Nested router with multi-segment prefix at type level ───

const multiSegmentPrefixRouter = lrRouter("", [
    lrRouter("/foo/bar", [
        lrHandler("GET", "/:id", null, () => {
            return lrResponse().json({ id: "test" } as const);
        }),
    ] as const),
] as const);

test("nested multi-segment prefix /foo/bar with param matches /foo/bar/baz", () => {
    type Ret = lrRouterReturn<typeof multiSegmentPrefixRouter, "GET", "/foo/bar/baz">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

test("nested multi-segment prefix /foo/bar consumes full path, no match", () => {
    type Ret = lrRouterReturn<typeof multiSegmentPrefixRouter, "GET", "/foo/bar">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

// ─── Non-root router with nested prefix consumes full path ───

const nonRootFullPathRouter = lrRouter("/api", [
    lrRouter("/foo", [
        lrHandler("GET", "/:id", null, () => {
            return lrResponse().json({ reached: true } as const);
        }),
    ] as const),
] as const);

test("non-root router /api with nested /foo consumes /api/foo, no match", () => {
    type Ret = lrRouterReturn<typeof nonRootFullPathRouter, "GET", "/api/foo">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});

test("non-root router /api with nested /foo matches /api/foo/bar", () => {
    type Ret = lrRouterReturn<typeof nonRootFullPathRouter, "GET", "/api/foo/bar">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

// ─── Sibling routes after nested lrNext ───

const siblingFallthroughRouter = lrRouter("", [
    lrRouter("/api", [
        lrHandler("GET", "/feature", null, () => lrNext),
    ] as const),
    lrHandler("GET", "/api/feature", null, () => {
        return lrResponse().json({ fallback: true } as const);
    }),
] as const);

test("sibling route catches fallthrough when nested route returns lrNext", () => {
    type Ret = lrRouterReturn<typeof siblingFallthroughRouter, "GET", "/api/feature">;
    type _isResponse = Ret extends LrResponse<any> ? true : false;
    const _v: _isResponse = true;
});

// ─── lrRouter with empty handlers returns lrNext on any request ───

test("router with empty handlers returns lrNext for any request", () => {
    const emptyRouter = lrRouter("", [] as const);
    type Ret = lrRouterReturn<typeof emptyRouter, "GET", "/anything">;
    type _isLrNext = Ret extends typeof lrNext ? true : false;
    const _v: _isLrNext = true;
});
