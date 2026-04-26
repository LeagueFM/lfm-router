export type httpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';

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

type matchMethods<definitionMethods extends '*' | httpMethod[], testMethod extends httpMethod> =
    definitionMethods extends '*' ? true
    : testMethod extends definitionMethods[number] ? true
    : false;

export type matchRequest<
    methods extends '*' | httpMethod[],
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

export type pathDefinitionToType<definitionPath extends string> =
    definitionPath extends `/${infer part}/${infer rest}`
    ? (
        part extends '*' ? never
        : (
            part extends `:${string}`
            ? `/${string}${pathDefinitionToType<`/${rest}`>}`
            : `/${part}${pathDefinitionToType<`/${rest}`>}`
        )
    ) : (
        definitionPath extends `/${infer part}`
        ? (
            part extends '*' ? `/${string}`
            : `/${part}`
        ) : never
    );

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

export type methodsDefinitionToMethods<definitionMethods extends '*' | httpMethod[]> =
    definitionMethods extends '*' ? httpMethod
    : definitionMethods[number];
