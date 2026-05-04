// © 2026 Oscar Knap - Alle rechten voorbehouden

import type { generalValidations, lrHandlerCallback } from "./handler";
import type { canRouterCallNext, lrRequest, matchRequest, recursiveSimplify, validationsToRequirements } from "./types";
import type { lrResponseObject, httpMethod } from "./response";

import { lrNext } from "./handler";
import { LrHandler } from "./handler";
import { LrResponse, } from "./response";

type generalRouterMatch = {
    type: 'router';
    router: LrRouter<'' | `/${string}`, readonly generalHandlerOrRouter[]>;
    matches: generalRouterMatchReturn[];
};

type generalHandlerMatch = {
    type: 'handler';
    handler: LrHandler<
        httpMethod[] | '*',
        `/${string}`,
        generalValidations<httpMethod[] | '*', `/${string}`>,
        lrHandlerCallback<httpMethod, `/${string}`, Record<string, any>, Record<string, any>, unknown>
    >;
};

type generalRouterMatchReturn = generalHandlerMatch | generalRouterMatch;

type routerMatchReturnInternal<
    pathPrefix extends '' | `/${string}`,
    handlers extends readonly any[], // can't be typed better here
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            matchRequest<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, testMethod, testPath> extends true
            ? (
                [
                    {
                        type: 'handler';
                        handler: LrHandler<firstHandlerMethods, firstHandlerPath, firstHandlerValidations, firstHandlerCallback>;
                    },
                    ...routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                ]
            ) : (
                routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
            )
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                routerMatchReturnInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath> extends [...infer firstElements, infer lastElement]
                ? (
                    [
                        {
                            type: 'router';
                            router: LrRouter<firstHandlerPathPrefix, firstHandlerHandlers>;
                            matches: [...firstElements, lastElement];
                        },
                        ...routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ]
                )
                // empty return, so router has no matches
                : [...routerMatchReturnInternal<pathPrefix, restHandlers, testMethod, testPath>]
            ) : never
        )
    ) : []; // handlers is empty array

type routerMatchReturn<
    pathPrefix extends '' | `/${string}`,
    handlers extends readonly generalHandlerOrRouter[],
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    {
        type: 'router';
        router: LrRouter<pathPrefix, handlers>;
        matches: routerMatchReturnInternal<pathPrefix, handlers, testMethod, testPath>;
    };

export type generalHandlerOrRouter = LrHandler<any, any, any, any> | LrRouter<any, any>;

export class LrRouter<pathPrefix extends '' | `/${string}`, handlers extends readonly generalHandlerOrRouter[]> {
    pathPrefix: pathPrefix;
    handlers: handlers;

    constructor(pathPrefix: pathPrefix, handlers: handlers) {
        this.pathPrefix = pathPrefix;
        this.handlers = handlers;
    }

    match<testMethod extends httpMethod, testPath extends `/${string}`>(method: testMethod, path: testPath):
        routerMatchReturn<pathPrefix, handlers, testMethod, testPath> {

        return this.#matchInternal('', method, path) as unknown as routerMatchReturn<pathPrefix, handlers, testMethod, testPath>;
    }

    #matchInternal(previousPathPrefix: string, method: httpMethod, path: `/${string}`): generalRouterMatch {
        const currentPathPrefix = `${previousPathPrefix}${this.pathPrefix}`;

        if (!path.startsWith(currentPathPrefix)) {
            return {
                type: 'router',
                router: this,
                matches: []
            };
        }

        let restPath = path.slice(currentPathPrefix.length);

        if (restPath === '') restPath = '/';

        if (!restPath.startsWith('/')) {
            return {
                type: 'router',
                router: this,
                matches: []
            };
        }

        let matches: generalRouterMatchReturn[] = [];

        for (const handler of this.handlers) {
            if (handler instanceof LrHandler) {
                const match = handler.match(method, restPath as `/${string}`);

                if (match) {
                    matches.push({
                        type: 'handler',
                        handler
                    });
                }
            } else if (handler instanceof LrRouter) {
                const match = handler.#matchInternal(currentPathPrefix, method, path);

                if (match.matches.length > 0) {
                    matches.push(match);
                }
            }
        }

        return {
            type: 'router',
            router: this,
            matches
        };
    }

    async execute<testMethod extends httpMethod, testPath extends `/${string}`>(req: lrRequest<testMethod, testPath>): Promise<lrRouterReturn<this, testMethod, testPath>> {
        const match = this.match(req.method, req.path);

        const response = await this.#executeInternal('', match, req);

        if (response === lrNext) {
            return lrNext as lrRouterReturn<this, testMethod, testPath>;
        }

        if (!(response instanceof LrResponse)) {
            throw new Error(`handler must return LrResponse, got typeof ${typeof response}`);
        }

        return response as lrRouterReturn<this, testMethod, testPath>;
    }

    async #executeInternal(
        currentPathPrefix: string,
        match: generalRouterMatchReturn,
        req: lrRequest<httpMethod, `/${string}`>
    ): Promise<LrResponse<lrResponseObject> | typeof lrNext> {
        if (match.type === 'handler') {
            const response = await match.handler.execute(currentPathPrefix, req);

            if (response === lrNext) {
                return lrNext;
            }

            if (!(response instanceof LrResponse)) {
                throw new Error(`handler (${Array.isArray(match.handler.methods) ? match.handler.methods.join(', ') : match.handler.methods} ${match.handler.path}) must return LrResponse or lrNext, got typeof ${typeof response}`);
            }

            return response;
        } else if (match.type === 'router') {
            currentPathPrefix = `${currentPathPrefix}${match.router.pathPrefix}`;

            for (const innerMatch of match.matches) {
                const response = await this.#executeInternal(currentPathPrefix, innerMatch, req);

                if (response === lrNext) {
                    continue;
                }

                if (!(response instanceof LrResponse)) {
                    throw new Error(`handler must return LrResponse or lrNext, got typeof ${typeof response}`);
                }

                return response;
            }
        }

        return lrNext;
    }
};

type routerReturnInternal<
    pathPrefix extends '' | `/${string}`,
    handlers extends readonly any[], // can't be typed better here
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            matchRequest<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, testMethod, testPath> extends true
            ? (
                Exclude<Awaited<ReturnType<firstHandlerCallback>>, typeof lrNext>
                | (
                    firstHandlerValidations extends { failResponse: (...args: any[]) => infer returnFailResponse }
                    ? (
                        Awaited<returnFailResponse>
                    ) : never
                )
                | (
                    (typeof lrNext) extends Awaited<ReturnType<firstHandlerCallback>> ? (
                        routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : never
                )
            )
            : routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                routerReturnInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                | (
                    canRouterCallNext<firstHandlerPathPrefix, firstHandlerHandlers, testMethod, testPath> extends true
                    ? (
                        routerReturnInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : never
                )
            ) : never
        )
    ) : (
        // no handlers
        never
    );

export type lrRouterReturn<
    router extends LrRouter<'' | `/${string}`, readonly generalHandlerOrRouter[]>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    router extends LrRouter<infer pathPrefix, infer handlers>
    ? (
        routerReturnInternal<pathPrefix, handlers, testMethod, testPath>
        | (
            canRouterCallNext<pathPrefix, handlers, testMethod, testPath> extends true
            ? typeof lrNext
            : never
        )
    ) : never;

type routerRequirementsInternal<
    pathPrefix extends '' | `/${string}`,
    handlers extends readonly any[], // can't be typed better here
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            matchRequest<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, testMethod, testPath> extends true
            ? (
                validationsToRequirements<firstHandlerValidations>
                & (
                    (typeof lrNext) extends Awaited<ReturnType<firstHandlerCallback>> ? (
                        routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : unknown
                )
            ) : routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                routerRequirementsInternal<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath>
                & (
                    canRouterCallNext<firstHandlerPathPrefix, firstHandlerHandlers, testMethod, testPath> extends true
                    ? (
                        routerRequirementsInternal<pathPrefix, restHandlers, testMethod, testPath>
                    ) : unknown
                )
            ) : never
        )
    ) : (
        // no handlers
        { body: {}, query: {} }
    )
    ;

export type lrRouterRequirements<
    router extends LrRouter<'' | `/${string}`, readonly generalHandlerOrRouter[]>,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    router extends LrRouter<infer pathPrefix, infer handlers>
    ? (
        recursiveSimplify<routerRequirementsInternal<pathPrefix, handlers, testMethod, testPath>>
    ) : never;

export function lrRouter<pathPrefix extends '' | `/${string}`, handlers extends readonly generalHandlerOrRouter[]>(pathPrefix: pathPrefix, handlers: handlers): LrRouter<pathPrefix, handlers> {
    return new LrRouter(pathPrefix, handlers);
}
