// © 2026 Oscar Knap - Alle rechten voorbehouden

import type z from "zod";
import type { LrHandler, lrNext } from "./handler";
import type { LrRouter } from "./router";
import type { httpMethod } from "./response";

export interface requestData {
    // user can augment this
};

export type lrRequest<
    method extends httpMethod,
    path extends `/${string}`,
> = {
    method: method;
    path: path;
    params: null; // null because there is no path definition
    query: Record<string, string>; // not generic, because this is before zod parsing
    body: unknown; // not generic, because this is before zod parsing
    data: requestData;
    ip: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
};

export type afterParseRequest<
    method extends httpMethod,
    path extends `/${string}`,
    params extends Record<string, any>, // any, because it can be transformed with zod
    query extends Record<string, any>, // any, because it can be transformed with zod
    body
> = {
    method: method;
    path: path;
    params: params;
    query: query;
    body: body;
    data: requestData;
    ip: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
};

export type simplify<T> =
    T extends object
    ? { [K in keyof T]: T[K] }
    : T;

export type recursiveSimplify<T> =
    T extends object
    ? { [K in keyof T]: recursiveSimplify<T[K]> }
    : T;

type partMatchPaths<definitionPart extends string, testPart extends string> =
    definitionPart extends `:${string}` ? true
    : definitionPart extends testPart ? true
    : false;

type matchPaths<definition extends string, test extends `/${string}`> =
    definition extends `/${infer definitionPart}/${infer definitionRest}`
    ? (
        test extends `/${infer testPart}/${infer testRest}`
        ? (
            definitionPart extends '*' ? never : // * can only be at end
            partMatchPaths<definitionPart, testPart> extends true
            ? matchPaths<`/${definitionRest}`, `/${testRest}`>
            : false
        ) : (
            definitionRest extends '*' ? (
                test extends `/${infer testPart}` ? partMatchPaths<definitionPart, testPart>
                : never
            ) :
            // definition has more than 1 part, but test only has 1
            false
        )
    ) : (
        definition extends `/${infer definitionPart}`
        ? (
            definitionPart extends '*' ? true
            : (
                test extends `/${string}/${string}` ? false // definition has 1 part, but test has more
                : (
                    test extends `/${infer testPart}` ? partMatchPaths<definitionPart, testPart> : never
                )
            )
        ) : (
            never
        )
    );

type matchMethods<definitionMethods extends '*' | httpMethod | httpMethod[], testMethod extends httpMethod> =
    definitionMethods extends '*' ? true
    : definitionMethods extends testMethod ? true
    : testMethod extends definitionMethods[number] ? true
    : false;

export type matchRequest<
    methods extends '*' | httpMethod | httpMethod[],
    path extends string,
    testMethod extends httpMethod,
    testPath extends `/${string}`
> =
    matchMethods<methods, testMethod> extends true
    ? (
        matchPaths<path, testPath> extends true
        ? true
        : false
    ) : false;

type pathDefinitionToTypeInternal<definitionPath extends string, withoutFirstSlash extends boolean = false> =
    definitionPath extends `/${infer part}/${infer rest}`
    ? (
        part extends '*' ? never
        : (
            part extends `:${string}`
            ? `${withoutFirstSlash extends true ? '' : '/'}${string}${pathDefinitionToTypeInternal<`/${rest}`>}`
            : `${withoutFirstSlash extends true ? '' : '/'}${part}${pathDefinitionToTypeInternal<`/${rest}`>}`
        )
    ) : (
        definitionPath extends `/${infer part}`
        ? (
            part extends '*' ? `${withoutFirstSlash extends true ? '' : '/'}${string}`
            : `${withoutFirstSlash extends true ? '' : '/'}${part}`
        ) : never
    );

// string before, because a router could have a path prefix
export type pathDefinitionToType<definitionPath extends string> = `/${string}${pathDefinitionToTypeInternal<definitionPath, true>}`;

type pathDefinitionToParamNames<definitionPath extends string> =
    definitionPath extends `/${infer part}/${infer rest}`
    ? (
        part extends '*' ? never
        : (
            part extends `:${infer paramName}`
            ? ([paramName, ...pathDefinitionToParamNames<`/${rest}`>])
            : pathDefinitionToParamNames<`/${rest}`>
        )
    ) : (
        definitionPath extends `/${infer part}`
        ? (
            part extends '*' ? ['*']
            : (
                part extends `:${infer paramName}`
                ? [paramName]
                : []
            )
        ) : never
    );

export type pathDefinitionToParams<definitionPath extends string> =
    pathDefinitionToParamNames<definitionPath> extends never ? never
    : {
        [k in pathDefinitionToParamNames<definitionPath>[number]]: string;
    };

export type methodsDefinitionToMethods<definitionMethods extends '*' | httpMethod | httpMethod[]> =
    definitionMethods extends '*' ? httpMethod
    : definitionMethods extends httpMethod ? definitionMethods
    : definitionMethods[number];

export type canRouterCallNext<
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
                (typeof lrNext) extends Awaited<ReturnType<firstHandlerCallback>>
                ? canRouterCallNext<pathPrefix, restHandlers, testMethod, testPath>
                : false
            ) : (
                canRouterCallNext<pathPrefix, restHandlers, testMethod, testPath>
            )
        ) : (
            firstHandler extends LrRouter<infer lastHandlerPathPrefix, infer lastHandlerHandlers>
            ? (
                canRouterCallNext<`${pathPrefix}${lastHandlerPathPrefix}`, lastHandlerHandlers, testMethod, testPath> extends true
                ? canRouterCallNext<pathPrefix, restHandlers, testMethod, testPath>
                : false
            ) : never // invalid lastHandler
        )
    ) : true; // empty handlers

export type validationsToRequirements<
    validations extends any // can't be typed better here
> =
    (validations extends { body: z.ZodType } ? { body: z.input<validations['body']> } : unknown)
    & (validations extends { query: z.ZodType } ? { query: z.input<validations['query']> } : unknown);

