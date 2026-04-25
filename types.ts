export type httpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';

type partMatchPaths<definitionPart extends string, testPart extends string> =
    definitionPart extends `:${string}` ? true
    : definitionPart extends testPart ? true
    : false;

type matchPaths<definition extends `/${string}`, test extends `/${string}`> =
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

export type matchRequest<definitionMethods extends '*' | httpMethod[], definitionPath extends `/${string}`, testMethod extends httpMethod, testPath extends `/${string}`> =
    matchMethods<definitionMethods, testMethod> extends true
    ? (
        matchPaths<definitionPath, testPath> extends true
        ? true
        : false
    ) : false;

