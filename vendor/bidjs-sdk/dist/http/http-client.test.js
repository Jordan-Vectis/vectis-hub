"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http_client_1 = require("./http-client");
const errors_1 = require("./errors");
const mockFetch = jest.fn();
global.fetch = mockFetch;
const client = new http_client_1.HttpClient({
    baseUrl: 'https://example.com',
    headers: { 'x-forwarded-client-id': 'auction' }
});
beforeEach(() => {
    mockFetch.mockReset();
});
describe('HttpClient', () => {
    describe('get', () => {
        it('should send a GET request with correct URL and headers', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: 'test' })
            });
            const result = await client.get('/api/v1/test');
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/v1/test', {
                method: 'GET',
                headers: { 'x-forwarded-client-id': 'auction' }
            });
            expect(result).toEqual({ data: 'test' });
        });
        it('should throw BidJSHttpError on non-2xx response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve('Not Found')
            });
            await expect(client.get('/api/v1/missing')).rejects.toThrow(errors_1.BidJSHttpError);
            await expect(client.get('/api/v1/missing')).rejects.toMatchObject({
                statusCode: 404,
                responseBody: 'Not Found'
            });
        });
    });
    describe('post', () => {
        it('should send a POST request with JSON body', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ id: 1 })
            });
            const result = await client.post('/api/v1/create', { name: 'test' });
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/v1/create', {
                method: 'POST',
                headers: {
                    'x-forwarded-client-id': 'auction',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ name: 'test' })
            });
            expect(result).toEqual({ id: 1 });
        });
        it('should throw BidJSHttpError on non-2xx response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: () => Promise.resolve('Internal Server Error')
            });
            await expect(client.post('/api/v1/create', {})).rejects.toThrow(errors_1.BidJSHttpError);
        });
    });
    describe('patch', () => {
        it('should send a PATCH request with JSON body', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ updated: true })
            });
            const result = await client.patch('/api/v1/update/1', { name: 'updated' });
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/v1/update/1', {
                method: 'PATCH',
                headers: {
                    'x-forwarded-client-id': 'auction',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ name: 'updated' })
            });
            expect(result).toEqual({ updated: true });
        });
        it('should throw BidJSHttpError on non-2xx response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 400,
                text: () => Promise.resolve('Bad Request')
            });
            await expect(client.patch('/api/v1/update/1', {})).rejects.toThrow(errors_1.BidJSHttpError);
        });
    });
    describe('setAccessToken', () => {
        it('should add authorization header to subsequent requests', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: 'test' })
            });
            const authClient = new http_client_1.HttpClient({
                baseUrl: 'https://example.com',
                headers: { 'x-forwarded-client-id': 'auction' }
            });
            authClient.setAccessToken('my-jwt-token');
            await authClient.get('/api/v1/test');
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/v1/test', {
                method: 'GET',
                headers: {
                    'x-forwarded-client-id': 'auction',
                    'authorization': 'Bearer my-jwt-token'
                }
            });
        });
    });
    describe('clearAccessToken', () => {
        it('should remove authorization header from subsequent requests', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: 'test' })
            });
            const authClient = new http_client_1.HttpClient({
                baseUrl: 'https://example.com',
                headers: { 'x-forwarded-client-id': 'auction' }
            });
            authClient.setAccessToken('my-jwt-token');
            authClient.clearAccessToken();
            await authClient.get('/api/v1/test');
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/v1/test', {
                method: 'GET',
                headers: { 'x-forwarded-client-id': 'auction' }
            });
        });
    });
    describe('response parsing', () => {
        it('should return undefined for 204 No Content', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 204,
                headers: new Map()
            });
            const result = await client.get('/api/v1/test');
            expect(result).toBeUndefined();
        });
        it('should parse JSON when content-type is application/json', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Map([['content-type', 'application/json; charset=utf-8']]),
                json: () => Promise.resolve({ data: 'test' })
            });
            const result = await client.get('/api/v1/test');
            expect(result).toEqual({ data: 'test' });
        });
        it('should return text when content-type is not JSON', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Map([['content-type', 'text/plain']]),
                text: () => Promise.resolve('plain text response')
            });
            const result = await client.get('/api/v1/test');
            expect(result).toBe('plain text response');
        });
        it('should default to JSON parsing when content-type header is absent', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Map(),
                json: () => Promise.resolve({ data: 'fallback' })
            });
            const result = await client.get('/api/v1/test');
            expect(result).toEqual({ data: 'fallback' });
        });
        it('should handle 204 No Content for POST', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 204,
                headers: new Map()
            });
            const result = await client.post('/api/v1/action', { id: 1 });
            expect(result).toBeUndefined();
        });
        it('should handle 204 No Content for DELETE', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 204,
                headers: new Map()
            });
            const result = await client.delete('/api/v1/remove/1', { ids: [1] });
            expect(result).toBeUndefined();
        });
    });
    describe('delete', () => {
        it('should send a DELETE request with JSON body', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ deleted: true })
            });
            const result = await client.delete('/api/v1/remove/1', { ids: [1, 2] });
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/v1/remove/1', {
                method: 'DELETE',
                headers: {
                    'x-forwarded-client-id': 'auction',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ ids: [1, 2] })
            });
            expect(result).toEqual({ deleted: true });
        });
        it('should send a DELETE request without body when none provided', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 204,
                headers: new Map()
            });
            await client.delete('/api/v1/remove/1');
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/v1/remove/1', {
                method: 'DELETE',
                headers: {
                    'x-forwarded-client-id': 'auction'
                }
            });
        });
        it('should throw BidJSHttpError on non-2xx response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve('Not Found')
            });
            await expect(client.delete('/api/v1/remove/999', {})).rejects.toThrow(errors_1.BidJSHttpError);
        });
    });
});
//# sourceMappingURL=http-client.test.js.map