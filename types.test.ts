// © 2026 Oscar Knap - Alle rechten voorbehouden

import { describe, test } from "bun:test";
import { expectTypeOf } from "expect-type";
import {
    lrRouter, lrHandler, lrResponse, lrNext,
    lrApp,
    type httpMethod, type lrRequest, type LrResponse,
    type lrHandlerRequest,
    type lrRouterReturn, type lrAppReturn,
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
