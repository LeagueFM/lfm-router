const MAX_SIZE = 90 * 1024 * 1024; // 90 MB
const MAX_FILES = 10;
const MAX_FIELDS = 100;

import type { IncomingMessage, ServerResponse } from "node:http";
import type { lrRequest, LrResponse, lrResponseObject } from ".";
import type { httpMethod } from "./types";

import Busboy from 'busboy';
import querystring from 'querystring';

type generalRequest = lrRequest<httpMethod, `/${string}`>;

function parseBody(nodeReq: IncomingMessage): Promise<unknown> {
    let contentType = nodeReq.headers['content-type'];
    if (contentType && Array.isArray(contentType)) {
        contentType = contentType[0];
    }
    if (!contentType) contentType = undefined;
    if (contentType) {
        contentType = contentType
            .split(';')[0]!
            .toLowerCase()
            .trim();
    }

    if (contentType && contentType === "application/json") {
        return new Promise((resolve, reject) => {
            let body = "";
            let size = 0;
            nodeReq.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_SIZE) {
                    nodeReq.destroy();
                    return reject(new Error("Body too large"));
                }

                body += chunk.toString();
            });
            nodeReq.on("end", () => {
                if (!body) {
                    return reject(new Error("No body"));
                }
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    if (contentType && contentType === "application/x-www-form-urlencoded") {
        return new Promise((resolve, reject) => {
            let body = "";
            let size = 0;
            nodeReq.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_SIZE) {
                    nodeReq.destroy();
                    return reject(new Error("Body too large"));
                }

                body += chunk.toString();
            });
            nodeReq.on("end", () => {
                try {
                    resolve(querystring.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    if (contentType && contentType == "multipart/form-data") {
        return new Promise((resolve, reject) => {
            let total = 0;

            nodeReq.on("data", (chunk: Buffer) => {
                total += chunk.length;

                if (total > MAX_SIZE) {
                    nodeReq.unpipe();        // stop piping to busboy
                    nodeReq.destroy();       // abort connection
                    return reject(new Error("Body too large"));
                }
            });

            const busboy = Busboy({
                headers: nodeReq.headers,
                limits: {
                    fileSize: MAX_SIZE,
                    fields: MAX_FIELDS,
                    files: MAX_FILES
                }
            });

            let fields: Record<string, string> = {};
            let files: Record<string, {
                field: string;
                name: string;
                mimeType: string;
                buffer: Buffer;
            }[]> = {};

            busboy.on("field", (name, val) => {
                fields[name] = val;
            });

            busboy.on("file", (name, file, info) => {
                const chunks: Buffer[] = [];
                file.on("data", d => chunks.push(d));
                file.on("end", () => {
                    if (!files[name]) files[name] = [];

                    files[name].push({
                        field: name,
                        name: info.filename,
                        mimeType: info.mimeType,
                        buffer: Buffer.concat(chunks),
                    });
                });
            });

            busboy.on("finish", () => {
                resolve({ fields, files });
            });

            busboy.on("error", reject);

            nodeReq.pipe(busboy);
        });
    }

    return Promise.resolve(null);
}

function parseCookies(nodeReq: IncomingMessage): Record<string, string> {
    let cookieHeader = nodeReq.headers['cookie'];
    if (cookieHeader && Array.isArray(cookieHeader)) {
        cookieHeader = cookieHeader[0];
    }
    if (!cookieHeader) {
        return {};
    };

    cookieHeader = cookieHeader.trim();

    const parts = cookieHeader.split(';');
    let cookies: Record<string, string> = {};

    for (const part of parts) {
        const [name, ...values] = part.trim().split('=');
        if (!name || values.length === 0) continue;
        if (name === '__proto__') continue;

        cookies[name] = values.join('=');
    }

    return cookies;
}

export async function transformNodeRequest(nodeReq: IncomingMessage): Promise<generalRequest> {
    let reqUrl = nodeReq.url;
    if (!reqUrl) {
        throw new Error('No url');
    }

    if (!reqUrl.startsWith('/')) {
        reqUrl = `/${reqUrl}`;
    }

    const parsedUrl = URL.parse(reqUrl as string, 'http://localhost');

    if (!parsedUrl) {
        throw new Error('Failed parsing url');
    }
    if (
        parsedUrl.protocol !== 'http:' ||
        parsedUrl.host !== 'localhost' ||
        parsedUrl.origin !== 'http://localhost' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== ''
    ) {
        throw new Error('Failed parsing url');
    }

    let path = parsedUrl.pathname;
    if (path.endsWith('/')) {
        path = path.slice(0, path.length - 1);
    }
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }

    let query: Record<string, string> = {};

    parsedUrl.searchParams.forEach((value, key) => {
        if (key === '_proto__') {
            return;
        }

        query[key] = value;
    });

    let headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (key === '__proto__') {
            continue;
        }
        if (!value) {
            continue;
        }
        if (Array.isArray(value)) {
            let first = value[0];
            if (!first) {
                continue;
            }
            headers[key] = first;
        } else {
            headers[key] = value;
        }
    }

    const body = await parseBody(nodeReq);

    const cookies = parseCookies(nodeReq);

    const req: generalRequest = {
        method: nodeReq.method as httpMethod,
        path: path as `/${string}`,
        params: null,
        query,
        body,
        data: {},
        ip: nodeReq.socket.remoteAddress as string,
        headers,
        cookies
    };

    return req;
}

function cookiesToHeader(cookies: lrResponseObject['cookies']): string[] {
    return Object.entries(cookies).map(([name, cookie]) => {
        const { value, options } = cookie;

        const encodedValue = encodeURIComponent(value);

        const parts: string[] = [`${name}=${encodedValue}`];

        if (options.path) parts.push(`Path=${options.path}`);
        if (options.domain) parts.push(`Domain=${options.domain}`);
        if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);

        if (options.httpOnly) parts.push('HttpOnly');
        if (options.secure) parts.push('Secure');
        if (options.partitioned) parts.push('Partitioned');

        if (options.sameSite) {
            parts.push(`SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`);
        }

        return parts.join('; ');
    });
}

export function sendNodeResponse(nodeRes: ServerResponse, responseClass: LrResponse<lrResponseObject>): Promise<void> {
    const response = responseClass.response;

    nodeRes.writeHead(response.status, response.statusMessage);

    let headers: Record<string, string | string[]> = {};

    if (Object.keys(response.cookies).length > 0) {
        headers['Set-Cookie'] = cookiesToHeader(response.cookies);
    }

    for (const [key, value] of Object.entries(response.headers)) {
        if (key === '__proto__') continue;

        headers[key] = value;
    }

    for (const [key, value] of Object.entries(headers)) {
        nodeRes.setHeader(key, value);
    }

    return new Promise((resolve, reject) => {
        if (response.body.type === 'json') {
            const stringified = JSON.stringify(response.body.body);
            nodeRes.end(stringified, resolve);
        } else if (response.body.type === 'text') {
            nodeRes.end(response.body.body, resolve);
        } else if (response.body.type === 'buffer') {
            nodeRes.end(response.body.body, resolve);
        } else {
            nodeRes.end();
        }
    });
}
