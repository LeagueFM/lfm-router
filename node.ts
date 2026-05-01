import type { IncomingMessage, ServerResponse } from "node:http";
import type { lrRequest, LrResponse, lrResponseObject } from ".";
import type { httpMethod } from "./types";

type generalRequest = lrRequest<httpMethod, `/${string}`>;

export function transformNodeRequest(nodeReq: IncomingMessage): generalRequest {
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

    const req: generalRequest = {
        method: nodeReq.method as httpMethod,
        path: path as `/${string}`,
        params: null,
        query,
        // todo: body
        data: {},
        ip: nodeReq.socket.remoteAddress as string,
        headers
        // todo: cookies
    };

    return req;
}

export function sendNodeResponse(nodeRes: ServerResponse, response: LrResponse<lrResponseObject>): void {
    // todo
}
