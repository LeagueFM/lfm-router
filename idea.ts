const handler = lrHandler('*', '/', async req => {
    return lrNext();
    return lrJson({ success: true });
    return lrStatus(500, lrJson({ success: false }));
});

const router = lrRouter();

const app = lrApp(router);

const server = app.createServer();
