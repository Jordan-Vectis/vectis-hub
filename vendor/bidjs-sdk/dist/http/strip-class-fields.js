"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripClassFields = stripClassFields;
exports.stripFields = stripFields;
function stripClassFields(obj) {
    if (Array.isArray(obj)) {
        return obj.map(stripClassFields);
    }
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key === '@class' || key === 'jacksonString' || key === 'rolesAndPrivileges')
                continue;
            result[key] = stripClassFields(value);
        }
        return result;
    }
    return obj;
}
function stripFields(obj, fields) {
    if (Array.isArray(obj)) {
        return obj.map(item => stripFields(item, fields));
    }
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (fields.includes(key))
                continue;
            result[key] = stripFields(value, fields);
        }
        return result;
    }
    return obj;
}
//# sourceMappingURL=strip-class-fields.js.map