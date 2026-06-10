#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const inputFile = resolve("openapi/openapi.yaml");
const outputFile = resolve("dist/openapi.json");

const bundled = bundle(inputFile, new Set());

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(bundled, null, 2)}\n`);
console.log(`Wrote ${outputFile}`);

function bundle(filePath: string, seen: Set<string>): Json {
  const absolutePath = resolve(filePath);
  if (seen.has(absolutePath)) {
    throw new Error(`Circular OpenAPI reference: ${absolutePath}`);
  }

  const parsed = YAML.parse(readFileSync(absolutePath, "utf8")) as Json;
  return resolveReferences(parsed, absolutePath, new Set([...seen, absolutePath]));
}

function resolveReferences(value: Json, currentFile: string, seen: Set<string>): Json {
  if (Array.isArray(value)) {
    return value.map((item) => resolveReferences(item, currentFile, seen));
  }

  if (!isObject(value)) return value;

  if (typeof value.$ref === "string" && isFileReference(value.$ref)) {
    const [refPath, pointer = ""] = value.$ref.split("#");
    const refFile = refPath ? resolve(dirname(currentFile), refPath) : currentFile;
    const target = pointer ? resolvePointer(bundle(refFile, seen), pointer) : bundle(refFile, seen);
    return resolveReferences(target, refFile, seen);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      resolveReferences(item as Json, currentFile, seen)
    ])
  );
}

function isFileReference(ref: string) {
  return !ref.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(ref);
}

function resolvePointer(document: Json, pointer: string): Json {
  const path = pointer.replace(/^#/, "");
  if (!path) return document;

  return path
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((target: Json, key) => {
      if (!isObject(target) && !Array.isArray(target)) {
        throw new Error(`Invalid JSON pointer segment "${key}" in ${pointer}`);
      }

      const next = (target as Record<string, Json>)[key];
      if (next === undefined) {
        throw new Error(`Missing JSON pointer segment "${key}" in ${pointer}`);
      }

      return next;
    }, document);
}

function isObject(value: Json): value is { [key: string]: Json } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
