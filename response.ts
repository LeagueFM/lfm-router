// © 2026 Oscar Knap - Alle rechten voorbehouden

import type { simplify } from './types.ts';

const defaultStatusMessages = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    410: 'Gone',
    413: 'Content Too Large',
    415: 'Unsupported Media Type',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    503: 'Service Unavailable',
} as const;

type responseBody = {
    type: 'json';
    body: object;
} | {
    type: 'text';
    body: string;
} | {
    type: 'buffer';
    body: Buffer;
};

export type responseCookieOptions = {
    httpOnly: boolean;
    secure: boolean;
    partitioned: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    path: string;
    domain: string;
    maxAge: number;
};

const defaultResponseCookieOptions = {
    httpOnly: false,
    secure: false,
    partitioned: false,
    sameSite: 'lax',
    path: '/',
    domain: '',
    /** 60 * 60 * 24 * 365 */
    maxAge: 31536000,
} as const satisfies responseCookieOptions;

type responseCookie = {
    value: string;
    options: responseCookieOptions;
};

export type responseWithHeaders<response extends lrResponseObject, headers extends Record<string, string>> =
    simplify<
        Omit<response, 'headers'>
        & {
            headers: simplify<Omit<response['headers'], keyof headers> & headers>;
        }
    >;

export type responseWithCookies<
    response extends lrResponseObject,
    cookies extends Record<
        string,
        { value: string } & Partial<responseCookieOptions>
    >
> =
    simplify<
        Omit<response, 'cookies'>
        & {
            cookies: simplify<
                Omit<response['cookies'], keyof cookies>
                & {
                    [K in keyof cookies]: {
                        value: cookies[K]['value'];
                        options: simplify<
                            Omit<Omit<cookies[K], 'value'>, Exclude<keyof Omit<cookies[K], 'value'>, keyof responseCookieOptions>>
                            & Omit<typeof defaultResponseCookieOptions, keyof Omit<cookies[K], 'value'>>
                        >;
                    }
                }
            >;
        }
    >;

export type lrResponseObject = {
    status: number;
    statusMessage: string;
    body: responseBody;
    headers: Record<string, string>;
    cookies: Record<string, responseCookie>;
};

export class LrResponse<response extends lrResponseObject> {
    response: response;

    constructor(response: response) {
        this.response = response;
    }

    status<status extends number, statusMessage extends string | undefined = undefined>(status: status, statusMessage?: statusMessage):
        LrResponse<
            simplify<
                {
                    status: status;
                    statusMessage:
                    statusMessage extends undefined
                    ? (
                        status extends keyof typeof defaultStatusMessages
                        ? (typeof defaultStatusMessages)[status]
                        : ''
                    ) : statusMessage;
                }
                & Omit<response, 'status' | 'statusMessage'>
            >
        > {
        return new LrResponse({
            ...this.response,
            status,
            statusMessage: statusMessage ?? defaultStatusMessages[status as keyof typeof defaultStatusMessages] ?? '',
        } as any);
    }

    header<key extends string, value extends string>(key: key, value: value):
        LrResponse<
            simplify<
                Omit<response, 'headers'>
                & {
                    headers: simplify<Omit<response['headers'], key> & { [x in key]: value }>;
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                [key]: value,
            }
        } as any);
    }

    headers<headers extends Record<string, string>>(headers: headers):
        LrResponse<responseWithHeaders<response, headers>> {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                ...headers,
            }
        } as any);
    }

    json<data extends object>(data: data):
        LrResponse<
            simplify<
                Omit<response, 'headers' | 'body'>
                & {
                    headers: simplify<Omit<response['headers'], 'Content-Type'> & { 'Content-Type': 'application/json' }>;
                    body: { type: 'json'; body: data; }
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                'Content-Type': 'application/json',
            },
            body: {
                type: 'json',
                body: data
            }
        } as any);
    }

    text<text extends string>(text: text):
        LrResponse<
            simplify<
                Omit<response, 'headers' | 'body'>
                & {
                    headers: simplify<Omit<response['headers'], 'Content-Type'> & { 'Content-Type': 'text/plain' }>;
                    body: { type: 'text'; body: text; }
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                'Content-Type': 'text/plain',
            },
            body: {
                type: 'text',
                body: text
            }
        } as any);
    }

    html<html extends string>(html: html):
        LrResponse<
            simplify<
                Omit<response, 'headers' | 'body'>
                & {
                    headers: simplify<Omit<response['headers'], 'Content-Type'> & { 'Content-Type': 'text/html' }>;
                    body: { type: 'text'; body: html; }
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                'Content-Type': 'text/html',
            },
            body: {
                type: 'text',
                body: html
            }
        } as any);
    }

    buffer<buffer extends Buffer>(buffer: buffer):
        LrResponse<
            simplify<
                Omit<response, 'body'>
                & {
                    body: { type: 'buffer'; body: buffer; }
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            body: {
                type: 'buffer',
                body: buffer
            }
        } as any);
    }

    type<type extends string>(type: type):
        LrResponse<
            simplify<
                Omit<response, 'headers'>
                & {
                    headers: simplify<Omit<response['headers'], 'Content-Type'> & { 'Content-Type': type }>;
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            headers: {
                ...this.response.headers,
                'Content-Type': type,
            }
        } as any);
    }

    redirect<url extends string>(url: url):
        LrResponse<
            simplify<
                {
                    status: 307;
                    statusMessage: (typeof defaultStatusMessages)[307];
                    headers: simplify<Omit<response['headers'], 'Location' | 'Content-Type'> & { 'Location': url; 'Content-Type': 'text/plain' }>;
                    body: { type: 'text'; body: ''; }
                } &
                Omit<response, 'status' | 'statusMessage' | 'headers' | 'body'>
            >
        > {
        return new LrResponse({
            ...this.response,
            status: 307,
            statusMessage: defaultStatusMessages[307],
            headers: {
                ...this.response.headers,
                'Location': url,
                'Content-Type': 'text/plain',
            },
            body: {
                type: 'text',
                body: ''
            }
        } as any);
    }

    permanentRedirect<url extends string>(url: url):
        LrResponse<
            simplify<
                {
                    status: 308;
                    statusMessage: (typeof defaultStatusMessages)[308];
                    headers: simplify<Omit<response['headers'], 'Location' | 'Content-Type'> & { 'Location': url; 'Content-Type': 'text/plain' }>;
                    body: { type: 'text'; body: ''; }
                } &
                Omit<response, 'status' | 'statusMessage' | 'headers' | 'body'>
            >
        > {
        return new LrResponse({
            ...this.response,
            status: 308,
            statusMessage: defaultStatusMessages[308],
            headers: {
                ...this.response.headers,
                'Location': url,
                'Content-Type': 'text/plain',
            },
            body: {
                type: 'text',
                body: ''
            }
        } as any);
    }

    cookie<
        name extends string,
        value extends string,
        options extends Partial<responseCookieOptions> | undefined = undefined
    >(name: name, value: value, options?: options):
        LrResponse<
            simplify<
                Omit<response, 'cookie'>
                & {
                    cookies: simplify<
                        Omit<response['cookies'], name>
                        & {
                            [key in name]: {
                                value: value;
                                options: options extends undefined
                                ? typeof defaultResponseCookieOptions
                                : simplify<
                                    Omit<options, Exclude<keyof options, keyof responseCookieOptions>>
                                    & Omit<typeof defaultResponseCookieOptions, keyof options>
                                >
                            }
                        }
                    >;
                }
            >
        > {
        return new LrResponse({
            ...this.response,
            cookies: {
                ...this.response.cookies,
                [name]: {
                    value,
                    options: options ? {
                        ...defaultResponseCookieOptions,
                        ...options,
                    } : defaultResponseCookieOptions
                },
            }
        } as any);
    }

    cookies<
        cookies extends Record<
            string,
            { value: string } & Partial<responseCookieOptions>
        >
    >(cookies: cookies):
        LrResponse<responseWithCookies<response, cookies>> {
        let newCookies = {} as Record<string, responseCookie>;

        for (const [name, { value, ...options }] of Object.entries(cookies)) {
            newCookies[name] = {
                value,
                options: {
                    ...defaultResponseCookieOptions,
                    ...options,
                }
            };
        }

        return new LrResponse({
            ...this.response,
            cookies: {
                ...this.response.cookies,
                ...newCookies
            }
        } as any);
    }
}

export function lrResponse() {
    return new LrResponse({
        status: 200,
        statusMessage: defaultStatusMessages[200],
        headers: {
            'Content-Type': 'text/html',
        },
        body: {
            type: 'text',
            body: ''
        },
        cookies: {}
    } as const);
}
