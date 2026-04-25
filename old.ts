// handlers can't be typed more specific here
type canRouterCallNext<handlers extends any[]> =
    handlers extends [...infer firstHandlers, infer lastHandler]
    ? (
        lastHandler extends LrHandler<infer lastHandlerMethods, infer lastHandlerPath, infer lastHandlerCallback>
        ? (
            (typeof nextSymbol) extends ReturnType<lastHandlerCallback> ? true : false
        ) : (
            lastHandler extends LrRouter<infer lastHandlerPathPrefix, infer lastHandlerHandlers>
            ? (
                canRouterCallNext<lastHandlerHandlers>
            ) : never // invalid lastHandler
        )
    ) : false;

// handlers can't be typed more specific here. this doesn't matter, because if handlers is invalid, never will be returned
type routerMatchReturn<pathPrefix extends '' | `/${string}`, handlers extends any[], testMethod extends httpMethod, testPath extends `/${string}`> =
    handlers extends [infer firstHandler, ...infer restHandlers]
    ? (
        firstHandler extends LrHandler<infer firstHandlerMethods, infer firstHandlerPath, infer firstHandlerValidations, infer firstHandlerCallback>
        ? (
            handlerMatchReturn<
                firstHandlerMethods,
                `${pathPrefix}${firstHandlerPath}`,
                firstHandlerValidations,
                firstHandlerCallback,
                testMethod,
                testPath
            >['matches'] extends true
            ? (
                // (typeof nextSymbol) extends ReturnType<firstHandlerCallback> ? (
                [
                    {
                        type: 'handler';
                        handler: LrHandler<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, firstHandlerCallback>;
                    },
                    ...routerMatchReturn<pathPrefix, restHandlers, testMethod, testPath>
                ]
                // ) :
                // (
                //     [
                //         {
                //             type: 'handler';
                //             handler: LrHandler<firstHandlerMethods, `${pathPrefix}${firstHandlerPath}`, firstHandlerCallback>;
                //         }
                //     ]
                // )
            ) : (
                routerMatchReturn<pathPrefix, restHandlers, testMethod, testPath>
            )
        ) : (
            firstHandler extends LrRouter<infer firstHandlerPathPrefix, infer firstHandlerHandlers>
            ? (
                routerMatchReturn<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers, testMethod, testPath> extends [...infer firstElements, infer lastElement]
                ? (
                    // canRouterCallNext<firstHandlerHandlers> extends true
                    // ? (
                    [
                        {
                            type: 'router';
                            router: LrRouter<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers>;
                            matches: [...firstElements, lastElement];
                        },
                        ...routerMatchReturn<pathPrefix, restHandlers, testMethod, testPath>
                    ]
                    // ) : (
                    //     [
                    //         {
                    //             type: 'router';
                    //             router: LrRouter<`${pathPrefix}${firstHandlerPathPrefix}`, firstHandlerHandlers>;
                    //             matches: [...firstElements, lastElement];
                    //         }
                    //     ]
                    // )
                )
                // empty return, so router has no matches
                : [...routerMatchReturn<pathPrefix, restHandlers, testMethod, testPath>]
            ) : never
        )
    ) : []; // handlers is empty array

// type a = routerMatchReturn<'', [
//     LrHandler<['GET'], '/foo/*', lrHandlerCallback>,
//     LrRouter<'/foo', [
//         LrHandler<['GET'], '/:param', () => LrResponse<lrResponseResponse>>,
//     ]>,
//     LrHandler<['GET'], '/foo/*', lrHandlerCallback>,
// ], 'GET', '/foo/hi'>;
