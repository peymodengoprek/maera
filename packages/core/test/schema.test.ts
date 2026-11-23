import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import Ajv from "ajv";
import {
  generateSchema,
  SOURCE_SPECS,
  STATUS_LEVELS,
  WIDGET_TYPES,
  type JsonSchema,
} from "../src/index.js";

const exampleUrl = new URL("../../../examples/index.maera", import.meta.url);
const schemaUrl = new URL("../../../schema/maera.schema.json", import.meta.url);

type Obj = Record<string, unknown>;

function widgetSchemas(schema: JsonSchema): JsonSchema[] {
  const properties = schema["properties"] as Obj;
  const widgets = properties["widgets"] as JsonSchema;
  const items = widgets["items"] as JsonSchema;
  return items["oneOf"] as JsonSchema[];
}

function sourceSchemas(schema: JsonSchema): JsonSchema[] {
  const properties = schema["properties"] as Obj;
  const sources = properties["sources"] as JsonSchema;
  const variants = sources["additionalProperties"] as JsonSchema;
  return variants["oneOf"] as JsonSchema[];
}

function constOf(schema: JsonSchema): unknown {
  const props = schema["properties"] as Obj;
  const type = props["type"] as JsonSchema;
  return type["const"];
}

function collectEnums(node: unknown, out: unknown[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectEnums(item, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "enum" && Array.isArray(value)) out.push(...value);
    collectEnums(value, out);
  }
}

test("generateSchema() valid sebagai JSON Schema dan sinkron dengan konstanta core", () => {
  const schema = generateSchema();

  assert.equal(schema["$schema"], "http://json-schema.org/draft-07/schema#");
  assert.equal(schema["type"], "object");
  assert.equal(schema["additionalProperties"], false);
  assert.deepEqual(JSON.parse(JSON.stringify(schema)), schema);

  const ajv = new Ajv({ strict: false });
  assert.doesNotThrow(() => ajv.compile(schema));

  const widgetTypes = widgetSchemas(schema).map(constOf).sort();
  assert.deepEqual(widgetTypes, [...WIDGET_TYPES].sort());

  const sourceTypes = sourceSchemas(schema).map(constOf).sort();
  assert.deepEqual(sourceTypes, (Object.keys(SOURCE_SPECS) as string[]).sort());

  const enums: unknown[] = [];
  collectEnums(schema, enums);
  for (const level of STATUS_LEVELS) {
    assert.ok(enums.includes(level), `status '${level}' tidak ada di schema`);
  }
});

test("schema/maera.schema.json di repo sinkron dengan generateSchema()", () => {
  const onDisk = JSON.parse(readFileSync(schemaUrl, "utf8")) as unknown;
  assert.deepEqual(onDisk, generateSchema());
});

test("examples/index.maera lulus validasi JSON Schema", () => {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(generateSchema());
  const doc = load(readFileSync(exampleUrl, "utf8"));
  const ok = validate(doc);
  assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
});
