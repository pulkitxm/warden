export interface JsonSchemaNode {
  type?: string;
  const?: unknown;
  enum?: readonly unknown[];
  required?: readonly string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  additionalProperties?: boolean;
}

export function validate(schema: JsonSchemaNode, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validate(schema.items as JsonSchemaNode, item, `${path}[${index}]`));
      });
    }
    return errors;
  }
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`${path}: expected object`];
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${path}.${key}: missing required key`);
    }
    for (const [key, entry] of Object.entries(record)) {
      const child = schema.properties?.[key];
      if (!child) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected key`);
        continue;
      }
      if (entry === undefined) continue;
      errors.push(...validate(child, entry, `${path}.${key}`));
    }
    return errors;
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${String(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${String(value)} not in enum`);
  }
  if (schema.type === "string" && typeof value !== "string")
    errors.push(`${path}: expected string`);
  if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path}: expected boolean`);
  }
  if (schema.type === "integer" && !Number.isInteger(value)) {
    errors.push(`${path}: expected integer`);
  }
  if (schema.type === "number" && typeof value !== "number")
    errors.push(`${path}: expected number`);
  return errors;
}
