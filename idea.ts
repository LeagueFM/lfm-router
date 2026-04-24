const handler = lrHandler('*', '/', async req => {
    return lrNext();
    return lrJson({ success: true });
    return lrStatus(500, lrJson({ success: false }));
    return lrRedirect('/');
});

// a router is a type of handler
const router = lrRouter([
    handler,
    router2,
    handler2
]);

const app = lrApp(router);

const server = app.createServer();
