// © 2026 Oscar Knap - Alle rechten voorbehouden

import { LrResponse } from "./response";
import { sendNodeResponse, transformNodeRequest } from "./node";
import { lrNext } from "./handler";

import type { canRouterCallNext, httpMethod, lrRequest } from "./types";
import type { lrResponseObject, responseCookieOptions, responseWithCookies, responseWithHeaders } from "./response";
import type { generalHandlerOrRouter, LrRouter, lrRouterRequirements, lrRouterReturn } from "./router";

// import type { z } from 'zod';
// todo: only type import and dev dep
import { z } from 'zod';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

type generalErrorResponseFunction =
    (req: lrRequest<httpMethod, `/${string}`>, error: unknown)
        => LrResponse<lrResponseObject> | Promise<LrResponse<lrResponseObject>>;

type noHandlerResponseFunction =
    (req: lrRequest<httpMethod, `/${string}`>)
        => LrResponse<lrResponseObject> | Promise<LrResponse<lrResponseObject>>;

type generalAddResponseHeaders =
    (req: lrRequest<httpMethod, `/${string}`>, res: LrResponse<lrResponseObject>) => Record<string, string> | Promise<Record<string, string>>;

type generalAddResponseCookies =
    (req: lrRequest<httpMethod, `/${string}`>, res: LrResponse<lrResponseObject>) =>
        Record<
            string,
            { value: string; } & Partial<responseCookieOptions>
        >
        | Promise<
            Record<
                string,
                { value: string; } & Partial<responseCookieOptions>
            >
        >;

class LrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    errorResponse extends LrResponse<lrResponseObject>,
    noHandlerResponse extends noHandlerResponseFunction,
    errorResponseFunction extends generalErrorResponseFunction | undefined,
    addResponseHeaders extends generalAddResponseHeaders | undefined,
    addResponseCookies extends generalAddResponseCookies | undefined
> {
    router: LrRouter<pathPrefix, handlers>;
    errorResponse: errorResponse;
    errorResponseFunction: errorResponseFunction;
    noHandlerResponse: noHandlerResponse;
    addResponseHeaders: addResponseHeaders;
    addResponseCookies: addResponseCookies;

    constructor(router: LrRouter<pathPrefix, handlers>, errorResponse: errorResponse, noHandlerResponse: noHandlerResponse, errorResponseFunction: errorResponseFunction, addResponseHeaders: addResponseHeaders, addResponseCookies: addResponseCookies) {
        this.router = router;
        this.errorResponse = errorResponse;
        this.errorResponseFunction = errorResponseFunction;
        this.noHandlerResponse = noHandlerResponse;
        this.addResponseHeaders = addResponseHeaders;
        this.addResponseCookies = addResponseCookies;
    }

    async execute<testMethod extends httpMethod, testPath extends `/${string}`>(req: lrRequest<testMethod, testPath>): Promise<lrAppReturn<this, testMethod, testPath>> {
        try {

            let response: LrResponse<lrResponseObject>;

            try {
                const routerResponse: LrResponse<lrResponseObject> | typeof lrNext = await this.router.execute(req);

                if (routerResponse === lrNext) {
                    const noHandlerResponse = await this.noHandlerResponse(req);

                    if (!(noHandlerResponse instanceof LrResponse)) {
                        throw new Error(`noHandlerResponse must return LrResponse, got typeof ${typeof noHandlerResponse}`);
                    }

                    response = noHandlerResponse;
                } else {
                    if (!((routerResponse as any) instanceof LrResponse)) {
                        throw new Error(`handler must return LrResponse, got typeof ${typeof routerResponse}`);
                    }

                    response = routerResponse as LrResponse<lrResponseObject>;
                }
            } catch (e) {
                if (!this.errorResponseFunction) {
                    throw e;
                }

                const errorResponse = await this.errorResponseFunction(req, e);

                if (!(errorResponse instanceof LrResponse)) {
                    throw new Error(`errorResponseFunction must return LrResponse, got typeof ${typeof errorResponse}`);
                }

                response = errorResponse;
            }

            if (this.addResponseHeaders) {
                const headers = await this.addResponseHeaders(req, response);
                response = response.headers(headers);
            }

            if (this.addResponseCookies) {
                const cookies = await this.addResponseCookies(req, response);
                response = response.cookies(cookies) as LrResponse<lrResponseObject>;
            }

            return response as lrAppReturn<this, testMethod, testPath>;

        } catch (e2) {
            console.warn('[lfm-router] Unhandled error', e2);
            return this.errorResponse as lrAppReturn<this, testMethod, testPath>;
        }
    }

    async nodeExecute(nodeReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {
        const req = await transformNodeRequest(nodeReq);

        const response = await this.execute(req);

        await sendNodeResponse(nodeRes, response);
    }

    createServer(): Server {
        const server = createServer(
            {
                keepAlive: true,
                requestTimeout: 1000 * 20
            },
            async (nodeReq, nodeRes) => {
                await this.nodeExecute(nodeReq, nodeRes);
            }
        );

        return server;
    }
};

type responseHeadersWrapper<
    addResponseHeaders extends generalAddResponseHeaders | undefined,
    response extends lrResponseObject
> =
    addResponseHeaders extends (req: any, res: any) => infer responseHeaders
    ? (
        Awaited<responseHeaders> extends Record<string, string>
        ? responseWithHeaders<response, Awaited<responseHeaders>>
        : response
    )
    : response;

type responseCookiesWrapper<
    addResponseCookies extends generalAddResponseCookies | undefined,
    response extends lrResponseObject
> =
    addResponseCookies extends (req: any, res: any) => infer responseCookies
    ? (
        Awaited<responseCookies> extends Record<
            string,
            { value: string; } & Partial<responseCookieOptions>
        >
        ? responseWithCookies<response, Awaited<responseCookies>>
        : response
    )
    : response;

type responseWrapper<
    addResponseHeaders extends generalAddResponseHeaders | undefined,
    addResponseCookies extends generalAddResponseCookies | undefined,
    response extends LrResponse<lrResponseObject>
> =
    response extends LrResponse<infer responseObject>
    ? LrResponse<
        responseHeadersWrapper<addResponseHeaders,
            responseCookiesWrapper<addResponseCookies,
                responseObject
            >
        >
    >
    : never;

export type lrAppReturn<
    app extends LrApp<
        '' | `/${string}`,
        generalHandlerOrRouter[],
        LrResponse<lrResponseObject>,
        noHandlerResponseFunction,
        generalErrorResponseFunction | undefined,
        generalAddResponseHeaders | undefined,
        generalAddResponseCookies | undefined
    >,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    app extends LrApp<
        infer pathPrefix,
        infer handlers,
        infer errorResponse,
        infer noHandlerResponse,
        infer errorResponseFunction,
        infer addResponseHeaders,
        infer addResponseCookies
    > ?
    (
        | responseWrapper<addResponseHeaders, addResponseCookies,
            Exclude<lrRouterReturn<LrRouter<pathPrefix, handlers>, testMethod, testPath>, typeof lrNext>
        >
        | responseWrapper<addResponseHeaders, addResponseCookies, (
            errorResponseFunction extends (...args: any[]) => infer returnErrorResponseFunction
            ? (
                Awaited<returnErrorResponseFunction> extends LrResponse<lrResponseObject>
                ? Awaited<returnErrorResponseFunction>
                : never
            )
            : never
        )>
        | responseWrapper<addResponseHeaders, addResponseCookies, (
            canRouterCallNext<pathPrefix, handlers, testMethod, testPath> extends true
            ? Awaited<ReturnType<noHandlerResponse>>
            : never
        )>
        | errorResponse
    ) : never;

export type lrAppRequirements<
    app extends LrApp<
        '' | `/${string}`,
        generalHandlerOrRouter[],
        LrResponse<lrResponseObject>,
        noHandlerResponseFunction,
        generalErrorResponseFunction | undefined,
        generalAddResponseHeaders | undefined,
        generalAddResponseCookies | undefined
    >,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    lrRouterRequirements<app['router'], testMethod, testPath>;

export function lrApp<
    pathPrefix extends '' | `/${string}`,
    handlers extends generalHandlerOrRouter[],
    options extends {
        errorResponse: LrResponse<lrResponseObject>;
        noHandlerResponse: noHandlerResponseFunction;
        errorResponseFunction?: generalErrorResponseFunction;
        addResponseHeaders?: generalAddResponseHeaders;
        addResponseCookies?: generalAddResponseCookies;
    }
>(router: LrRouter<pathPrefix, handlers>, options: options):
    LrApp<
        pathPrefix,
        handlers,
        options['errorResponse'],
        options['noHandlerResponse'],
        unknown extends options['errorResponseFunction'] ? undefined : options['errorResponseFunction'],
        unknown extends options['addResponseHeaders'] ? undefined : options['addResponseHeaders'],
        unknown extends options['addResponseCookies'] ? undefined : options['addResponseCookies']
    > {
    return new LrApp(
        router,
        options.errorResponse,
        options.noHandlerResponse,
        options.errorResponseFunction as any,
        options.addResponseHeaders as any,
        options.addResponseCookies as any
    );
}
