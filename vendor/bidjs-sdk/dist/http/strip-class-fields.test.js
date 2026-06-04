"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const strip_class_fields_1 = require("./strip-class-fields");
describe('stripClassFields', () => {
    it('should return primitives unchanged', () => {
        expect((0, strip_class_fields_1.stripClassFields)('hello')).toBe('hello');
        expect((0, strip_class_fields_1.stripClassFields)(42)).toBe(42);
        expect((0, strip_class_fields_1.stripClassFields)(true)).toBe(true);
        expect((0, strip_class_fields_1.stripClassFields)(null)).toBe(null);
    });
    it('should remove @class, jacksonString, and rolesAndPrivileges keys from an object', () => {
        const input = {
            '@class': 'com.example.Foo',
            jacksonString: 'raw',
            rolesAndPrivileges: ['ADMIN'],
            name: 'test',
            value: 1
        };
        expect((0, strip_class_fields_1.stripClassFields)(input)).toEqual({ name: 'test', value: 1 });
    });
    it('should recurse into nested objects', () => {
        const input = {
            name: 'parent',
            child: {
                '@class': 'com.example.Child',
                label: 'child'
            }
        };
        expect((0, strip_class_fields_1.stripClassFields)(input)).toEqual({ name: 'parent', child: { label: 'child' } });
    });
    it('should recurse into arrays', () => {
        const input = [
            { '@class': 'com.example.Item', id: 1 },
            { '@class': 'com.example.Item', id: 2 }
        ];
        expect((0, strip_class_fields_1.stripClassFields)(input)).toEqual([{ id: 1 }, { id: 2 }]);
    });
    it('should handle arrays nested inside objects', () => {
        const input = {
            items: [{ '@class': 'com.example.Item', id: 1 }]
        };
        expect((0, strip_class_fields_1.stripClassFields)(input)).toEqual({ items: [{ id: 1 }] });
    });
});
describe('stripFields', () => {
    it('should return primitives unchanged', () => {
        expect((0, strip_class_fields_1.stripFields)('hello', ['key'])).toBe('hello');
        expect((0, strip_class_fields_1.stripFields)(42, ['key'])).toBe(42);
        expect((0, strip_class_fields_1.stripFields)(null, ['key'])).toBe(null);
    });
    it('should remove specified keys from an object', () => {
        const input = { name: 'test', apiKeys: { key1: 'secret' }, value: 1 };
        expect((0, strip_class_fields_1.stripFields)(input, ['apiKeys'])).toEqual({ name: 'test', value: 1 });
    });
    it('should not remove keys not in the fields list', () => {
        const input = { name: 'test', value: 1 };
        expect((0, strip_class_fields_1.stripFields)(input, ['apiKeys'])).toEqual({ name: 'test', value: 1 });
    });
    it('should recurse into nested objects and remove fields at any depth', () => {
        const input = {
            outer: 'keep',
            nested: { apiKeys: 'remove', label: 'keep' }
        };
        expect((0, strip_class_fields_1.stripFields)(input, ['apiKeys'])).toEqual({
            outer: 'keep',
            nested: { label: 'keep' }
        });
    });
    it('should recurse into arrays', () => {
        const input = [
            { apiKeys: 'remove', id: 1 },
            { apiKeys: 'remove', id: 2 }
        ];
        expect((0, strip_class_fields_1.stripFields)(input, ['apiKeys'])).toEqual([{ id: 1 }, { id: 2 }]);
    });
    it('should support stripping multiple fields', () => {
        const input = { name: 'test', secret: 'remove', token: 'remove', value: 1 };
        expect((0, strip_class_fields_1.stripFields)(input, ['secret', 'token'])).toEqual({ name: 'test', value: 1 });
    });
});
//# sourceMappingURL=strip-class-fields.test.js.map