"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
const errors_1 = require("./errors");
class HttpClient {
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.headers = { ...config.headers };
    }
    setAccessToken(token) {
        this.headers['authorization'] = `Bearer ${token}`;
    }
    clearAccessToken() {
        delete this.headers['authorization'];
    }
    async get(path) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: this.headers
        });
        if (!response.ok) {
            const body = await response.text();
            throw new errors_1.BidJSHttpError(response.status, body);
        }
        return this.parseResponse(response);
    }
    async post(path, body) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...this.headers,
                'content-type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const responseBody = await response.text();
            throw new errors_1.BidJSHttpError(response.status, responseBody);
        }
        return this.parseResponse(response);
    }
    async patch(path, body) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                ...this.headers,
                'content-type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const responseBody = await response.text();
            throw new errors_1.BidJSHttpError(response.status, responseBody);
        }
        return this.parseResponse(response);
    }
    async delete(path, body) {
        const url = `${this.baseUrl}${path}`;
        const options = {
            method: 'DELETE',
            headers: { ...this.headers }
        };
        if (body !== undefined) {
            options.headers['content-type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            const responseBody = await response.text();
            throw new errors_1.BidJSHttpError(response.status, responseBody);
        }
        return this.parseResponse(response);
    }
    async parseResponse(response) {
        if (response.status === 204) {
            return undefined;
        }
        const contentType = response.headers?.get('content-type') ?? '';
        if (!contentType || contentType.includes('application/json')) {
            return response.json();
        }
        return await response.text();
    }
}
exports.HttpClient = HttpClient;
//# sourceMappingURL=http-client.js.map