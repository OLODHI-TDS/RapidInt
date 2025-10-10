const { app } = require('@azure/functions');

app.http('test', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log(`Http function processed request for url "${request.url}"`);

        const name = request.query.get('name') || await request.text() || 'World';

        return {
            status: 200,
            body: `Hello, ${name}! Azure Functions is working with Node.js v20.`,
            headers: {
                'Content-Type': 'text/plain'
            }
        };
    }
});