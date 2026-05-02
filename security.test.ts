// AI TESTS

import { afterAll, describe, expect, test } from "bun:test";
import { request } from "node:http";
import type { Server } from "node:http";

import { lrApp, lrHandler, lrResponse, lrRouter } from ".";

type TestHandler = ReturnType<typeof lrHandler>;

type TestResponse = {
    status: number | undefined;
    headers: Record<string, string | string[] | undefined>;
    body: string;
};

const servers: Server[] = [];

function createTestServer(handlers: TestHandler | TestHandler[]): Promise<Server> {
    const app = lrApp(lrRouter('', Array.isArray(handlers) ? handlers : [handlers]), {
        errorResponse: lrResponse().status(500).json({ ok: false } as const),
        noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
    });

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
