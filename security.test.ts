// AI TESTS

import { afterAll, describe, expect, test } from "bun:test";
import { request } from "node:http";
import type { Server } from "node:http";
import { connect } from "node:net";
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

function multipartBody(boundary: string, parts: {
    name: string;
    value: string;
    filename?: string;
    contentType?: string;
}[]): string {
    return parts.map(part => {
        const disposition = [
            `form-data; name="${part.name}"`,
            part.filename ? `filename="${part.filename}"` : null,
        ].filter(Boolean).join('; ');

        return [
            `--${boundary}`,
            `Content-Disposition: ${disposition}`,
            part.contentType ? `Content-Type: ${part.contentType}` : null,
            '',
            part.value,
        ].filter(line => line !== null).join('\r\n');
    }).join('\r\n') + `\r\n--${boundary}--\r\n`;
}

function rawHttpRequest(server: Server, requestText: string): Promise<TestResponse> {
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Test server is not listening on a TCP port');
    }

    return new Promise((resolve, reject) => {
        const socket = connect(address.port, '127.0.0.1');
        let responseText = '';

        socket.setEncoding('utf8');
        socket.on('connect', () => {
            socket.write(requestText);
        });
        socket.on('data', chunk => {
            responseText += chunk;
        });
        socket.on('error', reject);
        socket.on('end', () => {
            const [head = '', body = ''] = responseText.split('\r\n\r\n');
            const statusLine = head.split('\r\n')[0] ?? '';
            const status = Number(statusLine.split(' ')[1]);
            const headers: TestResponse['headers'] = Object.create(null);

            for (const line of head.split('\r\n').slice(1)) {
                const separatorIndex = line.indexOf(':');
                if (separatorIndex <= 0) continue;

                headers[line.slice(0, separatorIndex).toLowerCase()] = line.slice(separatorIndex + 1).trim();
            }

            resolve({ status, headers, body });
        });
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

    test('parses multipart fields and files', async () => {
        const boundary = 'lfm-router-test-boundary';
        const server = await createTestServer(lrHandler(['POST'], '/multipart', null, req => {
            const body = req.body as {
                fields: Record<string, string>;
                files: Record<string, {
                    name: string;
                    mimeType: string;
                    buffer: Buffer;
                }[]>;
            };

            return lrResponse().json({
                title: body.fields.title,
                fileName: body.files.upload?.[0]?.name,
                fileType: body.files.upload?.[0]?.mimeType,
                fileText: body.files.upload?.[0]?.buffer.toString('utf8'),
            } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/multipart',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: multipartBody(boundary, [
                { name: 'title', value: 'Quarter Final' },
                { name: 'upload', filename: 'match.txt', contentType: 'text/plain', value: 'Ajax 2-1 PSV' },
            ]),
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            title: 'Quarter Final',
            fileName: 'match.txt',
            fileType: 'text/plain',
            fileText: 'Ajax 2-1 PSV',
        });
    });

    test('uses null for unsupported content types', async () => {
        const server = await createTestServer(lrHandler(['POST'], '/raw', null, req => {
            return lrResponse().json({
                body: req.body,
            } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/raw',
            headers: {
                'Content-Type': 'application/octet-stream',
            },
            body: 'raw-body',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ body: null });
    });

    test('handles root routes explicitly', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/', null, req => {
            return lrResponse().json({
                path: req.path,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ path: '/' });
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

    test('supports all explicitly allowed HTTP methods', async () => {
        const methods = ['PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const;
        const server = await createTestServer(methods.map(method => lrHandler([method], '/resource', null, req => {
            return lrResponse().json({ method: req.method } as const);
        })));

        for (const method of methods) {
            const response = await httpRequest(server, {
                method,
                path: '/resource',
            });

            expect(response.status).toBe(200);
            expect(JSON.parse(response.body)).toEqual({ method });
        }
    });

    test('rejects HEAD before wildcard handlers run', async () => {
        let handlerReached = false;
        const server = await createTestServer(lrHandler('*', '/head', null, () => {
            handlerReached = true;
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            method: 'HEAD',
            path: '/head',
        });

        expect(response.status).toBe(500);
        expect(response.body).toBe('');
        expect(handlerReached).toBe(false);
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

    test('matches a top-level router with a non-empty prefix', async () => {
        const server = await createRouterServer(lrRouter('/api', [
            lrHandler(['GET'], '/status', null, () => {
                return lrResponse().json({ ok: true } as const);
            }),
        ]));

        const response = await httpRequest(server, {
            path: '/api/status',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ ok: true });
    });

    test('does not confuse router prefix boundaries', async () => {
        const server = await createRouterServer(lrRouter('', [
            lrRouter('/api', [
                lrHandler(['GET'], '/status', null, () => {
                    return lrResponse().json({ ok: true } as const);
                }),
            ]),
        ]));

        const response = await httpRequest(server, {
            path: '/apiadmin/status',
        });

        expect(response.status).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });
});

describe('features: direct execute APIs', () => {
    test('executes routers directly without Node HTTP', async () => {
        const router = lrRouter('', [
            lrHandler(['GET'], '/direct/:id', null, (req: any) => {
                const params = req.params as Record<string, string>;

                return lrResponse().json({ id: params.id } as const);
            }),
        ]);

        const response = await router.execute({
            method: 'GET',
            path: '/direct/abc',
            params: null,
            query: Object.create(null),
            body: null,
            data: Object.create(null),
            ip: '127.0.0.1',
            headers: Object.create(null),
            cookies: Object.create(null),
        });

        const lrResponseObject = response as any;

        expect(lrResponseObject.response.status).toBe(200);
        expect(lrResponseObject.response.body).toEqual({
            type: 'json',
            body: { id: 'abc' },
        });
    });

    test('executes apps directly and applies global response hooks', async () => {
        const app = lrApp(lrRouter('', [
            lrHandler(['GET'], '/direct', null, () => lrResponse().text('ok')),
        ]), {
            errorResponse: lrResponse().status(500).json({ ok: false } as const),
            noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
            addResponseHeaders: async () => ({ 'X-Direct': 'yes' }),
            addResponseCookies: async () => ({ direct: { value: 'yes' } }),
        });

        const response = await app.execute({
            method: 'GET',
            path: '/direct',
            params: null,
            query: Object.create(null),
            body: null,
            data: Object.create(null),
            ip: '127.0.0.1',
            headers: Object.create(null),
            cookies: Object.create(null),
        });

        const lrResponseObject = response as any;

        expect(lrResponseObject.response.status).toBe(200);
        expect(lrResponseObject.response.headers['X-Direct']).toBe('yes');
        expect(lrResponseObject.response.cookies.direct.value).toBe('yes');
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

    test('supports html responses', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/html', null, () => {
            return lrResponse().html('<h1>Hello</h1>');
        }));

        const response = await httpRequest(server, {
            path: '/html',
        });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('text/html');
        expect(response.body).toBe('<h1>Hello</h1>');
    });

    test('supports bulk headers and cookies helpers', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/bulk', null, () => {
            return lrResponse()
                .headers({ 'X-One': '1', 'X-Two': '2' })
                .cookies({
                    one: { value: '1' },
                    two: { value: '2', maxAge: 10 },
                })
                .json({ ok: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/bulk',
        });

        expect(response.headers['x-one']).toBe('1');
        expect(response.headers['x-two']).toBe('2');
        expect(response.headers['set-cookie']).toEqual([
            'one=1; Path=/; Max-Age=31536000; HttpOnly; Secure; Partitioned; SameSite=Lax',
            'two=2; Path=/; Max-Age=10; HttpOnly; Secure; Partitioned; SameSite=Lax',
        ]);
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

    test('supports async handlers, validations, and app hooks', async () => {
        const app = lrApp(lrRouter('', [
            lrHandler(['POST'], '/async/:id', {
                body: z.object({ ok: z.literal(true) }),
                params: z.object({ id: z.string() }),
                failResponse: async () => lrResponse().status(400).json({ ok: false } as const),
            }, async (req: any) => {
                return lrResponse().json({
                    id: req.params.id,
                    ok: req.body.ok,
                } as const);
            }),
        ]), {
            errorResponse: lrResponse().status(500).json({ ok: false } as const),
            noHandlerResponse: async () => lrResponse().status(404).json({ ok: false } as const),
            addResponseHeaders: async () => ({ 'X-Async': 'yes' }),
            addResponseCookies: async () => ({ async: { value: 'yes' } }),
        });

        const server = await listenToApp(app);
        const response = await httpRequest(server, {
            method: 'POST',
            path: '/async/abc',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ok: true }),
        });

        expect(response.status).toBe(200);
        expect(response.headers['x-async']).toBe('yes');
        expect(response.headers['set-cookie']).toEqual([
            'async=yes; Path=/; Max-Age=31536000; HttpOnly; Secure; Partitioned; SameSite=Lax',
        ]);
        expect(JSON.parse(response.body)).toEqual({
            id: 'abc',
            ok: true,
        });
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

    test('falls back to errorResponse when callbacks return invalid values', async () => {
        const invalidHandlerApp = lrApp(lrRouter('', [
            lrHandler(['GET'], '/invalid-handler', null, () => ({ invalid: true }) as any),
        ]), {
            errorResponse: lrResponse().status(500).json({ fallback: true } as const),
            noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
        });

        const invalidNoHandlerApp = lrApp(lrRouter('', []), {
            errorResponse: lrResponse().status(500).json({ fallback: true } as const),
            noHandlerResponse: (() => ({ invalid: true })) as any,
        });

        const invalidErrorFunctionApp = lrApp(lrRouter('', [
            lrHandler(['GET'], '/throws', null, () => {
                throw new Error('boom');
            }),
        ]), {
            errorResponse: lrResponse().status(500).json({ fallback: true } as const),
            noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
            errorResponseFunction: (() => ({ invalid: true })) as any,
        });

        const invalidFailResponseApp = lrApp(lrRouter('', [
            lrHandler(['POST'], '/validation', {
                body: z.object({ ok: z.literal(true) }),
                failResponse: (() => ({ invalid: true })) as any,
            }, () => lrResponse().json({ ok: true } as const)),
        ]), {
            errorResponse: lrResponse().status(500).json({ fallback: true } as const),
            noHandlerResponse: () => lrResponse().status(404).json({ ok: false } as const),
        });

        const invalidHandlerServer = await listenToApp(invalidHandlerApp);
        const invalidNoHandlerServer = await listenToApp(invalidNoHandlerApp);
        const invalidErrorFunctionServer = await listenToApp(invalidErrorFunctionApp);
        const invalidFailResponseServer = await listenToApp(invalidFailResponseApp);

        const responses = await Promise.all([
            httpRequest(invalidHandlerServer, { path: '/invalid-handler' }),
            httpRequest(invalidNoHandlerServer, { path: '/missing' }),
            httpRequest(invalidErrorFunctionServer, { path: '/throws' }),
            httpRequest(invalidFailResponseServer, {
                method: 'POST',
                path: '/validation',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ok: false }),
            }),
        ]);

        for (const response of responses) {
            expect(response.status).toBe(500);
            expect(JSON.parse(response.body)).toEqual({ fallback: true });
        }
    });
});

describe('edge cases: route definitions', () => {
    test('rejects invalid rest route definitions', () => {
        expect(() => lrHandler(['GET'], '/files/*/tail', null, () => {
            return lrResponse();
        })).toThrow('* path part must be last');
    });

    test('rejects empty and reserved param names', () => {
        expect(() => lrHandler(['GET'], '/items/:', null, () => {
            return lrResponse();
        })).toThrow('Param name cannot be empty');

        expect(() => lrHandler(['GET'], '/items/:rest', null, () => {
            return lrResponse();
        })).toThrow('Param name cannot be rest');
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

    test('rejects invalid response header values without leaking them', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/bad-header', null, () => {
            return lrResponse()
                .header('X-Bad', 'safe\r\nInjected: bad')
                .json({ ok: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/bad-header',
        });

        expect(response.status).toBe(500);
        expect(response.headers['x-bad']).toBeUndefined();
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

    test('does not collapse repeated slashes into a protected route', async () => {
        let handlerReached = false;
        const server = await createTestServer(lrHandler(['GET'], '/admin', null, () => {
            handlerReached = true;
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await rawHttpRequest(server, [
            'GET //admin HTTP/1.1',
            'Host: localhost',
            'Connection: close',
            '',
            '',
        ].join('\r\n'));

        expect(response.status).toBe(500);
        expect(handlerReached).toBe(false);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });

    test('does not match encoded traversal after URL parsing normalizes it', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/files/:name', null, () => {
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            path: '/files/%2e%2e',
        });

        expect(response.status).toBe(404);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });

    test('keeps encoded backslash bytes as route data', async () => {
        const server = await createTestServer(lrHandler(['GET'], '/files/:name', null, req => {
            const params = req.params as Record<string, string>;

            return lrResponse().json({
                name: params.name,
            } as const);
        }));

        const response = await httpRequest(server, {
            path: '/files/a%5cb',
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ name: 'a%5cb' });
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

    test('empty JSON bodies fail closed before the handler runs', async () => {
        let handlerReached = false;
        const server = await createTestServer(lrHandler(['POST'], '/json-empty', null, () => {
            handlerReached = true;
            return lrResponse().json({ reached: true } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/json-empty',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        expect(response.status).toBe(500);
        expect(handlerReached).toBe(false);
        expect(JSON.parse(response.body)).toEqual({ ok: false });
    });

    test('multipart bodies drop prototype-pollution field and file names', async () => {
        const boundary = 'lfm-router-pollution-boundary';
        const server = await createTestServer(lrHandler(['POST'], '/multipart-pollution', null, req => {
            const body = req.body as {
                fields: Record<string, string>;
                files: Record<string, unknown[]>;
            };

            return lrResponse().json({
                safeField: body.fields.safe,
                protoField: body.fields.__proto__ ?? null,
                constructorField: body.fields.constructor ?? null,
                safeFiles: body.files.upload?.length ?? 0,
                protoFiles: body.files.__proto__ ?? null,
                constructorFiles: body.files.constructor ?? null,
            } as const);
        }));

        const response = await httpRequest(server, {
            method: 'POST',
            path: '/multipart-pollution',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: multipartBody(boundary, [
                { name: 'safe', value: 'yes' },
                { name: '__proto__', value: 'polluted' },
                { name: 'constructor', value: 'bad' },
                { name: 'upload', filename: 'safe.txt', contentType: 'text/plain', value: 'safe' },
                { name: '__proto__', filename: 'bad.txt', contentType: 'text/plain', value: 'bad' },
                { name: 'constructor', filename: 'bad.txt', contentType: 'text/plain', value: 'bad' },
            ]),
        });

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            safeField: 'yes',
            protoField: null,
            constructorField: null,
            safeFiles: 1,
            protoFiles: null,
            constructorFiles: null,
        });
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
