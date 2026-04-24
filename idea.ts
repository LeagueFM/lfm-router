import { lrHandler, lrApp, lrRouter, lrNext, lrResponse } from ".";

const handler1 = lrHandler('*', '/', async req => {
    // 
});

const handler2 = lrHandler('*', '/', async req => {
    // return lrNext();
    // return lrJson({ success: true });
    // return lrStatus(500, lrJson({ success: false }));
    // return lrRedirect('/');
    return lrResponse().status(500).json({ success: false });
});

const router = lrRouter([
    handler1,
]);

const app = lrApp(router);

const server = app.createServer();
