// AI TESTS

import { afterAll, describe, expect, test } from "bun:test";
import { request } from "node:http";
import type { Server } from "node:http";
import { z } from "zod";

import { lrApp, lrHandler, lrNext, lrResponse, lrRouter } from ".";

type TestHandler = any;
type TestRouter = any;

type TestResponse = {
    status: number | undefined;
    headers: Record<string, string | string[] | undefined>;
    body: string;
};

const servers: Server[] = [];

function createTestServer(handlers: TestHandler | TestHandler[]): Promise<Server> {
    return createRouterServer(lrRouter('', Array.isArray(handlers) ? handlers : [handlers]));
}

function createRouterServer(router: TestRouter): Promise<Server> {
    const app = lrApp(router, {
        errorResponse: lrResponse().status(500).json({ ok: false } as const),
        noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
    });

    return listenToApp(app);
}

function listenToApp(app: any): Promise<Server> {
    const server = app.createServer();
    servers.push(server);

    return new Promise(resolve => {
        server.listen(0, () => resolve(server));
    });
}

function httpRequest(server: Server, options: {
    method?: string;
    path?: string;
    headers?: Record<string, string | string[]>;
    body?: string;
} = {}): Promise<TestResponse> {
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Test server is not listening on a TCP port');
    }

    return new Promise((resolve, reject) => {
        const req = request({
            port: address.port,
            method: options.method ?? 'GET',
            path: options.path ?? '/',
            headers: options.headers,
        }, res => {
            let body = '';

            res.setEncoding('utf8');
            res.on('data', chunk => {
                body += chunk;
            });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body,
                });
            });
        });

        req.on('error', reject);

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}

afterAll(async () => {
    await Promise.all(servers.map(server => new Promise<void>(resolve => {
        server.close(() => resolve());
    })));
});

describe('features: normal request handling', () => {
    test('returns text responses with status and content type', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/hello', null, () => {
            return lrResponse().status(201).text('created');
        }));

        const response = await httpRequest(server, {
            path: '/hello',
        });

        expect(response.status).toBe(201);
        expect(response.headers['content-type']).toBe('text/plain');
        expect(response.body).toBe('created');
    });

    test('parses JSON request bodies and exposes them to handlers', async () => {
        const server = await createTestServer(lrHandler(['POST'], '/json', null, req => {
            return lrResponse().json({
                body: req.body,
            } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/json',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({ name: 'Oscar', nested: { ok: true }, list: [1, 2, 3] }),
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            body: { name: 'Oscar', nested: { ok: true }, list: [1, 2, 3] },
        });
    });

    test('parses urlencoded request bodies including repeated keys', async () => {
        const server = await createTestServer(lrHandler(['POST'], '/form', null, req => {
            return lrResponse().json({
                body: req.body,
            } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/form',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'name=Oscar&tag=one&tag=two&empty=',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            body: {
                name: 'Oscar',
                tag: ['one', 'two'],
                empty: '',
            },
        });
    });

    test('returns the configured no-handler response for unmatched routes', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/known', null, () => {
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/missing',
        });

        expect(response.status).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });
});

describe('features: route matching and fallthrough', () => {
    test('matches handlers by HTTP method', async () => {
        const server = await createTestServer([
            lrHandler(['GET'], '/resource', null, () => {
                return lrResponse().json({ method: 'GET' } as const);
            }),
            lrHandler(['POST'], '/resource', null, () => {
                return lrResponse().json({ method: 'POST' } as const);
            }),
        ]);

        const getResponse = await httpRequest(server, {
            method: 'GET',
            path: '/resource',
        });
        const postResponse = await httpRequest(server, {
            method: 'POST',
            path: '/resource',
        });

        expect(JSON.parse(getResponse.body)).toEqual({ method: 'GET' });
        expect(JSON.parse(postResponse.body)).toEqual({ method: 'POST' });
    });

    test('runs later matching handlers when an earlier handler returns lrNext', async () => {
        const calls: string[] = [];
        const server = await createTestServer([
            lrHandler(['GET'], '/chain', null, () => {
                calls.push('first');
                return lrNext;
            }),
            lrHandler(['GET'], '/chain', null, () => {
                calls.push('second');
                return lrResponse().json({ calls } as const);
            }),
        ]);

        const response = await httpRequest(server, {
            path: '/chain',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ calls: ['first', 'second'] });
    });

    test('stops at the first matching handler that returns a response', async () => {
        let secondReached = false;
        const server = await createTestServer([
            lrHandler(['GET'], '/chain', null, () => {
                return lrResponse().json({ handler: 'first' } as const);
            }),
            lrHandler(['GET'], '/chain', null, () => {
                secondReached = true;
                return lrResponse().json({ handler: 'second' } as const);
            }),
        ]);

        const response = await httpRequest(server, {
            path: '/chain',
        });

        expect(JSON.parse(response.body)).toEqual({ handler: 'first' });
        expect(secondReached).toBe(false);
    });

    test('captures multiple named params without decoding path segments', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/teams/:teamId/members/:memberId', null, req => {
            const params = req.params as Record<string, string>;

            return lrResponse().json({
                teamId: params.teamId,
                memberId: params.memberId,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/teams/league%20fm/members/oscar',
        });

        expect(JSON.parse(response.body)).toEqual({
            teamId: 'league%20fm',
            memberId: 'oscar',
        });
    });
});

describe('features: validations', () => {
    test('returns validation failResponse when body validation fails', async () => {
        let handlerReached = false;
        const server = await createTestServer(lrHandler(['POST'], '/validate', {
            body: z.object({
                name: z.string(),
                count: z.number(),
            }),
            failResponse: (_req, errors) => {
                return lrResponse().status(400).json({
                    bodyError: Boolean(errors.bodyError),
                } as const);
            },
        }, () => {
            handlerReached = true;
            return lrResponse().json({ ok: true } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/validate',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: 'Oscar', count: 'not-a-number' }),
        });

        expect(response.status).toBe(400);
        expect(handlerReached).toBe(false);
        expect(JSON.parse(response.body)).toEqual({ bodyError: true });
    });

    test('passes transformed query and params into the handler after validation', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/items/:id', {
            query: z.object({
                page: z.string().transform(value => Number(value)),
            }),
            params: z.object({
                id: z.string().transform(value => Number(value)),
            }),
            failResponse: () => lrResponse().status(400).json({ ok: false } as const),
        }, req => {
            return lrResponse().json({
                id: req.params.id,
                page: req.query.page,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/items/42?page=3',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            id: 42,
            page: 3,
        });
    });
});

describe('features: nested routers', () => {
    test('matches a single-level nested router with a prefix', async () => {
        const server = await createRouterServer(lrRouter('', [
            lrRouter('/api', [
                lrHandler(['GET'], '/status', null, () => {
                    return lrResponse().json({ ok: true } as const);
                }),
            ]),
        ]));

        const response = await httpRequest(server, {
            path: '/api/status',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ ok: true });
    });

    test('matches a two-level nested router with accumulated prefixes', async () => {
        const server = await createRouterServer(lrRouter('', [
            lrRouter('/api', [
                lrRouter('/v1', [
                    lrHandler(['GET'], '/status', null, () => {
                        return lrResponse().json({ version: 1 } as const);
                    }),
                ]),
            ]),
        ]));

        const response = await httpRequest(server, {
            path: '/api/v1/status',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ version: 1 });
    });

    test('continues to sibling routes when a nested route returns lrNext', async () => {
        const server = await createRouterServer(lrRouter('', [
            lrRouter('/api', [
                lrHandler(['GET'], '/feature', null, () => lrNext),
            ]),
            lrHandler(['GET'], '/api/feature', null, () => {
                return lrResponse().json({ fallback: true } as const);
            }),
        ]));

        const response = await httpRequest(server, {
            path: '/api/feature',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ fallback: true });
    });
});

describe('features: response helpers', () => {
    test('supports redirects and permanent redirects', async () => {
        const server = await createTestServer([
            lrHandler(['GET'], '/temporary', null, () => lrResponse().redirect('/next')),
            lrHandler(['GET'], '/permanent', null, () => lrResponse().permanentRedirect('/forever')),
        ]);

        const temporary = await httpRequest(server, {
            path: '/temporary',
        });
        const permanent = await httpRequest(server, {
            path: '/permanent',
        });

        expect(temporary.status).toBe(307);
        expect(temporary.headers.location).toBe('/next');
        expect(permanent.status).toBe(308);
        expect(permanent.headers.location).toBe('/forever');
    });

    test('supports buffer responses with an explicit content type', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/buffer', null, () => {
            return lrResponse()
                .type('application/octet-stream')
                .buffer(Buffer.from('abc'));
        }));

        const response = await httpRequest(server, {
            path: '/buffer',
        });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/octet-stream');
        expect(response.body).toBe('abc');
    });
});

describe('features: app options and error handling', () => {
    test('adds global response headers and cookies after handler execution', async () => {
        const app = lrApp(lrRouter('', [
            lrHandler(['GET'], '/global', null, () => lrResponse().json({ ok: true } as const)),
        ]), {
            errorResponse: lrResponse().status(500).json({ ok: false } as const),
            noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
            addResponseHeaders: () => ({
                'X-App-Header': 'present',
            }),
            addResponseCookies: () => ({
                global: { value: 'yes' },
            }),
        });

        const server = await listenToApp(app);
        const response = await httpRequest(server, {
            path: '/global',
        });

        expect(response.status).toBe(200);
        expect(response.headers['x-app-header']).toBe('present');
        expect(response.headers['set-cookie']).toEqual([
            'global=yes; Path=/; Max-Age=31536000; HttpOnly; Secure; Partitioned; SameSite=Lax',
        ]);
        expect(JSON.parse(response.body)).toEqual({ ok: true });
    });

    test('uses errorResponseFunction for handler errors without leaking the thrown message', async () => {
        const app = lrApp(lrRouter('', [
            lrHandler(['GET'], '/boom', null, () => {
                throw new Error('secret-internal-message');
            }),
        ]), {
            errorResponse: lrResponse().status(500).json({ fallback: true } as const),
            noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
            errorResponseFunction: (_req, error) => {
                expect(error).toBeInstanceOf(Error);
                return lrResponse().status(503).json({ handled: true } as const);
            },
        });

        const server = await listenToApp(app);
        const response = await httpRequest(server, {
            path: '/boom',
        });

        expect(response.status).toBe(503);
        expect(response.body).not.toContain('secret-internal-message');
        expect(JSON.parse(response.body)).toEqual({ handled: true });
    });

    test('falls back to errorResponse when addResponseHeaders throws', async () => {
        const app = lrApp(lrRouter('', [
            lrHandler(['GET'], '/headers-fail', null, () => lrResponse().json({ ok: true } as const)),
        ]), {
            errorResponse: lrResponse().status(500).json({ fallback: true } as const),
            noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
            addResponseHeaders: () => {
                throw new Error('global-header-failed');
            },
        });

        const server = await listenToApp(app);
        const response = await httpRequest(server, {
            path: '/headers-fail',
        });

        expect(response.status).toBe(500);
        expect(response.body).not.toContain('global-header-failed');
        expect(JSON.parse(response.body)).toEqual({ fallback: true });
    });
});

describe('edge cases: route definitions', () => {
    test('rejects invalid rest route definitions', () => {
        expect(() => lrHandler(['GET'], '/files/*/tail', null, () => {
            return lrResponse();
        })).toThrow('* path part must be last');
    });

    test('rejects duplicate and unsafe param names', () => {
        expect(() => lrHandler(['GET'], '/items/:id/:id', null, () => {
            return lrResponse();
        })).toThrow('Param id already exists');

        expect(() => lrHandler(['GET'], '/items/:__proto__', null, () => {
            return lrResponse();
        })).toThrow('Param name cannot be __proto__');
    });

    test('rejects response cookies with unsafe security attribute combinations', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/bad-cookie', null, () => {
            return lrResponse()
                .cookie('bad', 'value', { sameSite: 'none', secure: false, partitioned: false })
                .json({ ok: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/bad-cookie',
        });

        expect(response.status).toBe(500);
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });
});

describe('security: cookies', () => {
    test('parses safe percent-encoded request cookies as application values', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/cookies', null, req => {
            return lrResponse().json({
                theme: req.cookies.theme,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/cookies',
            headers: {
                Cookie: 'theme=dark%20mode',
            },
        });

        expect(JSON.parse(response.body)).toEqual({ theme: 'dark mode' });
    });

    test('drops prototype-pollution and encoded-control request cookies', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/cookies', null, req => {
            return lrResponse().json({
                proto: req.cookies.__proto__ ?? null,
                constructorCookie: req.cookies.constructor ?? null,
                prototypeCookie: req.cookies.prototype ?? null,
                unsafe: req.cookies.unsafe ?? null,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/cookies',
            headers: {
                Cookie: '__proto__=polluted; constructor=bad; prototype=bad; unsafe=%0d%0a',
            },
        });

        expect(JSON.parse(response.body)).toEqual({
            proto: null,
            constructorCookie: null,
            prototypeCookie: null,
            unsafe: null,
        });
    });

    test('encodes response cookie values and sends hardening attributes', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/set-cookie', null, () => {
            return lrResponse()
                .cookie('session', 'a b;c=ok')
                .json({ ok: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/set-cookie',
        });

        expect(response.headers['set-cookie']).toEqual([
            'session=a%20b%3Bc%3Dok; Path=/; Max-Age=31536000; HttpOnly; Secure; Partitioned; SameSite=Lax',
        ]);
    });
});

describe('security: request normalization', () => {
    test('drops prototype-pollution query keys before handlers receive the request', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/query', null, req => {
            return lrResponse().json({
                proto: req.query.__proto__ ?? null,
                constructorQuery: req.query.constructor ?? null,
                prototypeQuery: req.query.prototype ?? null,
                safe: req.query.safe,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/query?__proto__=polluted&constructor=bad&prototype=bad&safe=yes',
        });

        expect(JSON.parse(response.body)).toEqual({
            proto: null,
            constructorQuery: null,
            prototypeQuery: null,
            safe: 'yes',
        });
    });

    test('decodes query values and uses the last value for duplicate query keys', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/query', null, req => {
            return lrResponse().json({
                next: req.query.next,
                multi: req.query.multi,
                empty: req.query.empty,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/query?next=%2Fdashboard%3Ftab%3Dhome&multi=first&empty=&multi=second',
        });

        expect(JSON.parse(response.body)).toEqual({
            next: '/dashboard?tab=home',
            multi: 'second',
            empty: '',
        });
    });

    test('rejects unsupported HTTP methods before wildcard handlers run', async () => {
        let handlerReached = false;

        const server = await createTestServer(lrHandler('*', '/method', null, () => {
            handlerReached = true;
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            method: 'TRACE',
            path: '/method',
        });

        expect(response.status).toBe(500);
        expect(handlerReached).toBe(false);
    });
});

describe('security: headers', () => {
    test('normalizes request header names and exposes Node-combined duplicate header values', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/headers', null, req => {
            return lrResponse().json({
                token: req.headers['x-test-token'],
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/headers',
            headers: {
                'X-Test-Token': ['first', 'second'],
            },
        });

        expect(JSON.parse(response.body)).toEqual({
            token: 'first, second',
        });
    });

    test('drops prototype-pollution request header keys before handlers receive the request', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/headers', null, req => {
            return lrResponse().json({
                proto: req.headers.__proto__ ?? null,
                constructorHeader: req.headers.constructor ?? null,
                prototypeHeader: req.headers.prototype ?? null,
                safe: req.headers['x-safe'],
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/headers',
            headers: {
                constructor: 'bad',
                prototype: 'bad',
                'X-Safe': 'yes',
            },
        });

        expect(JSON.parse(response.body)).toEqual({
            proto: null,
            constructorHeader: null,
            prototypeHeader: null,
            safe: 'yes',
        });
    });

    test('sends response headers before writing the response body', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/headers', null, () => {
            return lrResponse()
                .header('X-Security-Test', 'present')
                .json({ ok: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/headers',
        });

        expect(response.status).toBe(200);
        expect(response.headers['x-security-test']).toBe('present');
        expect(response.headers['content-type']).toBe('application/json');
        expect(JSON.parse(response.body)).toEqual({ ok: true });
    });
});

describe('security: path normalization and route matching', () => {
    test('normalizes a trailing slash to the same route', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/admin', null, req => {
            return lrResponse().json({
                path: req.path,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/admin/',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ path: '/admin' });
    });

    test('does not let encoded literal paths bypass exact route matching', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/admin', null, () => {
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/%61dmin',
        });

        expect(response.status).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });

    test('does not match extra path segments without an explicit rest route', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/admin', null, () => {
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/admin/..',
        });

        expect(response.status).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });

    test('captures encoded slashes as param data instead of path separators', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/files/:name', null, req => {
            const params = req.params as Record<string, string>;

            return lrResponse().json({
                name: params.name,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/files/a%2Fb',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ name: 'a%2Fb' });
    });

    test('only explicit rest routes match additional path segments', async () => {
        const server = await createTestServer([
            lrHandler(['GET'], '/files/:name', null, () => {
                return lrResponse().json({ type: 'single' } as const);
            }),
            lrHandler(['GET'], '/files/*', null, req => {
                const params = req.params as Record<string, string>;

                return lrResponse().json({
                    type: 'rest',
                    rest: params['*'],
                } as const);
            }),
        ]);

        const response = await httpRequest(server, {
            path: '/files/a/b',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            type: 'rest',
            rest: 'a/b',
        });
    });
});

describe('security: body parsing', () => {
    test('invalid JSON fails closed before the handler runs', async () => {
        let handlerReached = false;

        const server = await createTestServer(lrHandler(['POST'], '/json', null, () => {
            handlerReached = true;
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/json',
            headers: {
                'Content-Type': 'application/json',
            },
            body: '{"broken":',
        });

        expect(response.status).toBe(500);
        expect(handlerReached).toBe(false);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });

    test('urlencoded bodies parse into a null-prototype object and drop inherited pollution behavior', async () => {
        const server = await createTestServer(lrHandler(['POST'], '/form', null, req => {
            const body = req.body as Record<string, unknown>;

            return lrResponse().json({
                safe: body.safe,
                proto: body.__proto__ ?? null,
                prototype: body.prototype ?? null,
                constructorValue: body.constructor ?? null,
            } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/form',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: '__proto__=polluted&prototype=bad&constructor=bad&safe=yes',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            safe: 'yes',
            proto: null,
            prototype: null,
            constructorValue: null,
        });
    });
});
